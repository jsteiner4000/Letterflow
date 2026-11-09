// Rückfrage im Stil der App (kein Systemdialog). Liefert true bei „ja“, false bei Abbrechen/Esc.
window.bestaetigen = ({ titel, text, ja, nein = 'Abbrechen' }) =>
  new Promise((fertig) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'rueckfrage';
    dialog.setAttribute('aria-labelledby', 'rueckfrage-titel');
    dialog.setAttribute('aria-describedby', 'rueckfrage-text');
    const h = Object.assign(document.createElement('h2'), {
      id: 'rueckfrage-titel',
      textContent: titel,
    });
    const p = Object.assign(document.createElement('p'), {
      id: 'rueckfrage-text',
      textContent: text,
    });
    const knoepfe = Object.assign(document.createElement('div'), { className: 'knoepfe' });
    const knopf = (beschriftung, klasse, wert) => {
      const b = Object.assign(document.createElement('button'), {
        type: 'button',
        className: klasse,
        textContent: beschriftung,
      });
      b.addEventListener('click', () => dialog.close(wert));
      return b;
    };
    const jaKnopf = knopf(ja, 'knopf haupt', 'ja');
    knoepfe.append(jaKnopf, knopf(nein, 'knopf', 'nein'));
    dialog.append(h, p, knoepfe);
    // Esc schließt mit leerem returnValue = Abbrechen.
    dialog.addEventListener('close', () => {
      dialog.remove();
      fertig(dialog.returnValue === 'ja');
    });
    document.body.append(dialog);
    dialog.showModal();
    jaKnopf.focus();
  });
