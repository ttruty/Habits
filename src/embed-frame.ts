// iframe entry (embed.html?share=<token>&weeks=1&theme=auto): turns query params into attributes.
import '../design/tokens.css';
import './styles/fonts.css';
import './components/habit-scorecard';
import { applyTheme } from './theme';

const params = new URLSearchParams(location.search);
const card = document.createElement('habit-scorecard');
for (const name of ['share', 'weeks', 'theme']) {
  const value = params.get(name);
  if (value !== null) card.setAttribute(name, value);
}
document.body.append(card);

// The frame is its own page, so the theme goes on its <html> like the app's.
const theme = params.get('theme');
applyTheme(theme === 'light' || theme === 'dark' ? theme : 'system');
