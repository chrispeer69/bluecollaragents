"""Small, admin-triggered business website importer powered by Scrapling."""

import ipaddress
import json
import re
import socket
from urllib.parse import urljoin, urlparse

from fastapi import HTTPException
from scrapling.fetchers import Fetcher

MAX_PAGES = 4
MAX_CONTEXT = 18_000
INTERESTING_LINKS = ("about", "service", "contact", "hours", "location")


def normalize_url(value: str) -> str:
    value = value.strip()
    if not value:
        raise HTTPException(422, "Enter a business website domain")
    if "://" not in value:
        value = "https://" + value
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        raise HTTPException(422, "Enter a public HTTP or HTTPS business website")
    if parsed.port and parsed.port not in {80, 443}:
        raise HTTPException(422, "Only standard website ports are supported")
    host = parsed.hostname.rstrip(".").lower()
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, parsed.port or 443)}
    except socket.gaierror as exc:
        raise HTTPException(422, "That domain could not be resolved") from exc
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise HTTPException(422, "Only public internet domains can be imported")
    return parsed._replace(netloc=host, path=parsed.path or "/", fragment="").geturl()


def values(page, selector: str) -> list[str]:
    return [re.sub(r"\s+", " ", str(value)).strip() for value in page.css(selector).getall()]


def json_ld_facts(page) -> tuple[list[str], list[str], list[str]]:
    hours, phones, addresses = [], [], []
    candidates = values(page, 'script[type="application/ld+json"]::text')
    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except (TypeError, ValueError):
            continue
        queue = data if isinstance(data, list) else [data]
        while queue:
            item = queue.pop(0)
            if not isinstance(item, dict):
                continue
            graph = item.get("@graph")
            if isinstance(graph, list):
                queue.extend(graph)
            opening = item.get("openingHours")
            if isinstance(opening, str):
                hours.append(opening)
            elif isinstance(opening, list):
                hours.extend(str(entry) for entry in opening)
            specification = item.get("openingHoursSpecification")
            if isinstance(specification, dict):
                specification = [specification]
            if isinstance(specification, list):
                for entry in specification:
                    if isinstance(entry, dict):
                        days = entry.get("dayOfWeek", "")
                        if isinstance(days, list):
                            days = ", ".join(str(day).rsplit("/", 1)[-1] for day in days)
                        hours.append(f"{days}: {entry.get('opens', '')}–{entry.get('closes', '')}")
            if item.get("telephone"):
                phones.append(str(item["telephone"]))
            address = item.get("address")
            if isinstance(address, str):
                addresses.append(address)
            elif isinstance(address, dict):
                parts = [
                    address.get(key)
                    for key in ("streetAddress", "addressLocality", "addressRegion", "postalCode")
                ]
                formatted = ", ".join(str(part) for part in parts if part)
                if formatted:
                    addresses.append(formatted)
    return hours, phones, addresses


def unique(items: list[str], limit: int = 20) -> list[str]:
    result = []
    for item in items:
        clean = re.sub(r"\s+", " ", item).strip(" \n\t|–-")
        if clean and clean.casefold() not in {value.casefold() for value in result}:
            result.append(clean)
        if len(result) >= limit:
            break
    return result


def scrape_business(domain: str) -> dict:
    start_url = normalize_url(domain)
    root_host = urlparse(start_url).hostname
    pending, visited, pages = [start_url], set(), []
    all_titles, descriptions, headings, hours, phones, addresses = [], [], [], [], [], []

    while pending and len(visited) < MAX_PAGES:
        url = normalize_url(pending.pop(0))
        if url in visited or urlparse(url).hostname != root_host:
            continue
        visited.add(url)
        try:
            page = Fetcher.get(url, timeout=15, retries=1, follow_redirects="safe")
        except Exception as exc:
            if len(visited) == 1:
                raise HTTPException(422, "The website could not be fetched") from exc
            continue
        final_url = normalize_url(str(getattr(page, "url", url)))
        if urlparse(final_url).hostname != root_host:
            continue
        pages.append(final_url)
        all_titles.extend(values(page, "title::text"))
        descriptions.extend(values(page, 'meta[name="description"]::attr(content)'))
        headings.extend(values(page, "h1::text, h2::text, h3::text"))
        page_hours, page_phones, page_addresses = json_ld_facts(page)
        hours.extend(page_hours)
        phones.extend(page_phones)
        addresses.extend(page_addresses)
        if len(visited) == 1:
            for href in values(page, "a[href]::attr(href)"):
                candidate = urljoin(final_url, href).split("#", 1)[0]
                parsed = urlparse(candidate)
                interesting = any(
                    word in parsed.path.lower() for word in INTERESTING_LINKS
                )
                if parsed.hostname == root_host and interesting:
                    pending.append(candidate)

    title = unique(all_titles, 3)
    description = unique(descriptions, 5)
    services = unique(headings, 30)
    hours = unique(hours, 20)
    phones = unique(phones, 5)
    addresses = unique(addresses, 5)
    sections = [
        ("Business", title),
        ("What the business says it does", description),
        ("Services and website sections", services),
        ("Business hours", hours),
        ("Phone", phones),
        ("Address", addresses),
    ]
    context = "\n".join(
        f"{label}:\n" + "\n".join(f"- {item}" for item in items)
        for label, items in sections
        if items
    )[:MAX_CONTEXT]
    if not context:
        raise HTTPException(422, "No useful business information was found on that website")
    return {
        "domain": start_url,
        "content": context,
        "pages": pages,
        "facts": {
            "titles": title,
            "descriptions": description,
            "services": services,
            "hours": hours,
            "phones": phones,
            "addresses": addresses,
        },
    }
