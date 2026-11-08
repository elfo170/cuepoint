import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import css from './widget.css?inline';

export const HOST_ID = 'cuepoint-widget-host';

/**
 * Monta o conteúdo num Shadow DOM isolado, para que o CSS do SoundCloud e o do widget
 * não interfiram um no outro.
 */
export function mountInShadow(node: ReactNode, doc: Document = document): Root {
  doc.getElementById(HOST_ID)?.remove();
  const host = doc.createElement('div');
  host.id = HOST_ID;
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483646';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';
  doc.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // @property não funciona dentro de shadow roots: registra essas regras no documento.
  const properties = css.match(/@property[^{]+\{[^}]*\}/g) ?? [];
  if (properties.length && !doc.getElementById('cuepoint-properties')) {
    const global = doc.createElement('style');
    global.id = 'cuepoint-properties';
    global.textContent = properties.join('\n');
    doc.head.appendChild(global);
  }
  const style = doc.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  const container = doc.createElement('div');
  shadow.appendChild(container);
  const root = createRoot(container);
  root.render(node);
  return root;
}
