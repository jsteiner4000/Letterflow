// Passt den Diktattext an die Stelle an, an der er eingefügt wird (Text um die Schreibmarke vom Helfer).
// Mitten im Satz: kein Schlusspunkt, Leerzeichen zum Nachbarwort, Funktionswörter klein.

// Nur Wörter, die mitten im Satz sicher klein stehen; nie Nomen (im Deutschen groß).
const FUNKTIONSWOERTER = new Set(
  (
    'der die das den dem des ein eine einen einem einer eines und oder aber sondern denn dass weil ' +
    'wenn als ob ich du er sie es wir ihr man mich mir dich dir sich uns euch ihn ihm mit von zu ' +
    'zum zur im in auf für bei nach aus an am um über unter vor durch ohne nicht noch auch schon ' +
    'dann so wie da hier dort jetzt nur sehr ist sind war hat haben wird werden kann muss soll ' +
    'the a an and or but so to of in on at for with from by is are was it we you they he she ' +
    'this that not also just then'
  ).split(' '),
);

// Erstes Wort klein, wenn es ein Funktionswort ist („Ich“ → „ich“, „Rechnung“ bleibt).
const funktionswortKlein = (t) =>
  t.replace(/^(\p{Lu})(\p{Ll}*)(?![\p{L}\p{N}])/u, (w, a, rest) =>
    FUNKTIONSWOERTER.has(w.toLowerCase()) ? a.toLowerCase() + rest : w,
  );

// vor/nach: Text vor bzw. nach der Schreibmarke; null/undefined = unbekannt (dann unverändert).
function anpassen(text, { vor, nach } = {}) {
  if (typeof vor !== 'string' && typeof nach !== 'string') return text;
  let t = text;
  // Nur die aktuelle Zeile zählt: eine neue Zeile beginnt neu.
  const davor = typeof vor === 'string' ? vor.split(/[\r\n]/).pop() : '';
  const danach = typeof nach === 'string' ? nach.split(/[\r\n]/)[0] : '';
  if (/\S/.test(danach)) {
    t = t.replace(/([^.])\.$/, '$1');
    if (/^[\p{L}\p{N}]/u.test(danach)) t += ' ';
  }
  const letztes = davor.trimEnd().slice(-1);
  if (letztes && !/[.!?:]/.test(letztes)) t = funktionswortKlein(t);
  if (/[\p{L}\p{N},.;:!?]$/u.test(davor)) t = ' ' + t;
  return t;
}

module.exports = { anpassen, funktionswortKlein };
