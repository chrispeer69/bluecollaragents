import './styles.css';
import './experience.css';
import './platform.css';
import { mountBookingPage } from './booking';

const host = document.querySelector<HTMLElement>('#sales-calendar');
if (!host) throw new Error('Sales calendar container is missing');
mountBookingPage(host);
