// iframe entry (embed.html?share=<token>&weeks=1&theme=auto): turns query params into attributes.
import './components/habit-scorecard';

const params = new URLSearchParams(location.search);
const card = document.createElement('habit-scorecard');
for (const name of ['share', 'weeks', 'theme']) {
  const value = params.get(name);
  if (value !== null) card.setAttribute(name, value);
}
document.body.append(card);
