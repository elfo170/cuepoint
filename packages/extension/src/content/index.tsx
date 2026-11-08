import { App } from './App';
import { mountInShadow } from './widget/mount';

if (!window.top || window.top === window) {
  mountInShadow(<App />);
}
