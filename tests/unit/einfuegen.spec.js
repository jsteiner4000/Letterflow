const { test, expect } = require('@playwright/test');
const { anpassen, funktionswortKlein } = require('../../src/main/einfuegen');

test('Nichts gelesen → unverändert', () => {
  expect(anpassen('Ich komme morgen.', {})).toBe('Ich komme morgen.');
  expect(anpassen('Ich komme morgen.', { vor: null, nach: null })).toBe('Ich komme morgen.');
});

test('Mitten im Satz: kein Punkt, Leerzeichen, Funktionswort klein', () => {
  // „Hallo Tim,| das Recap.“ → Einschub „Ich schicke dir“
  expect(anpassen('Ich schicke dir.', { vor: 'Hallo Tim,', nach: ' das Recap.' })).toBe(
    ' ich schicke dir',
  );
  // direkt vor einem Wort: Leerzeichen danach
  expect(anpassen('Sehr.', { vor: 'Das ist ', nach: 'gut.' })).toBe('sehr ');
  // Nomen bleiben groß, ? bleibt
  expect(anpassen('Rechnung?', { vor: 'die', nach: ' bitte' })).toBe(' Rechnung?');
});

test('Satzende davor oder Zeilenende danach', () => {
  // nach Satzende: groß bleiben, Leerzeichen davor; nichts dahinter: Punkt bleibt
  expect(anpassen('Ich komme.', { vor: 'Gut.', nach: '' })).toBe(' Ich komme.');
  // neue Zeile: wie am Anfang
  expect(anpassen('Ich komme.', { vor: 'Gut,\n', nach: '\nGruß' })).toBe('Ich komme.');
  // Ende des Textes nach einem Wort: Leerzeichen, klein, Punkt bleibt
  expect(anpassen('Und morgen.', { vor: 'heute', nach: '' })).toBe(' und morgen.');
});

test('Funktionswörter klein, andere Wörter nie', () => {
  expect(funktionswortKlein('Ich auch.')).toBe('ich auch.');
  expect(funktionswortKlein('The end')).toBe('the end');
  expect(funktionswortKlein('Montag passt')).toBe('Montag passt');
  expect(funktionswortKlein('ICH')).toBe('ICH');
});
