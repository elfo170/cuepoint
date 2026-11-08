/** Id do elemento que hospeda o Shadow DOM do widget. */
export const HOST_ID = 'cuepoint-widget-host';

export const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

export function isEditable(el: EventTarget | undefined): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  );
}

/**
 * Impede que teclas digitadas nos campos do widget acionem os atalhos do SoundCloud.
 *
 * Fora do Shadow DOM, o alvo do evento aparece como o host do widget (e não como um campo de
 * texto), então a página trataria a tecla como atalho. Este ouvinte de captura na `window` é
 * registrado em `document_start` (antes dos scripts da página) e interrompe a propagação para
 * a página. Digitar e enviar formulário são ações padrão do navegador e continuam funcionando.
 */
export function installKeyboardGuard(win: Window = window): void {
  for (const type of KEY_EVENTS) {
    win.addEventListener(
      type,
      (e) => {
        const host = win.document.getElementById(HOST_ID);
        if (host && e.target === host && isEditable(e.composedPath()[0])) {
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  }
}
