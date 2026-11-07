import { describe, expect, it } from 'vitest';
import { explainNoData } from '../src/explain.js';

const MENU_DE = 'Übersicht\nImperium\nRohstoffe\nGebäude\nForschung\nSchiffswerft\nVerteidigung\nFlotte\nGalaxie\nAllianz\nNachrichten\nStatistik\nRekorde';

describe('explainNoData (E-4)', () => {
  it('tells the page from the HTML body id and the language from <html lang>', () => {
    expect(explainNoData({ html: '<html lang="de"><body id="shipyard" class="x"><div>…</div></body></html>', text: 'x' })).toEqual({ code: 'unsupported_page', page: 'shipyard' });
    expect(explainNoData({ html: '<html lang="de"><body id="galaxy">', text: 'x' })).toEqual({ code: 'parse_failed', page: 'galaxy' });
    expect(explainNoData({ html: '<html lang="fr"><body id="galaxy">', text: 'x' })).toEqual({ code: 'language', lang: 'fr', page: 'galaxy' });
    expect(explainNoData({ html: '<div>x</div>', text: 'Schiffswerft', url: 'https://pr0game.com/uni8/game.php?page=records' })).toEqual({ code: 'unsupported_page', page: 'records' });
  });

  it('guesses the page of copied text from a menu title shown twice', () => {
    expect(explainNoData({ text: `${MENU_DE}\nRekorde\nGebäude Spieler Stufe` })).toEqual({ code: 'unsupported_page', page: 'records' });
    expect(explainNoData({ text: `${MENU_DE}\nirgendwas ohne Titel und noch mehr Text` })).toEqual({ code: 'unknown_game_page' });
  });

  it('tells text that is no game page, too short or in another language', () => {
    expect(explainNoData({ text: 'hallo' })).toEqual({ code: 'too_short' });
    expect(explainNoData({ text: 'Dies ist ein ganz normaler Text aus einem Forum über das Wetter am Wochenende.' })).toEqual({ code: 'not_game' });
    expect(explainNoData({ text: 'Visión general Imperio Recursos Edificios Investigacion Galaxia Mensajes Alianza Estadísticas' })).toEqual({ code: 'language', lang: 'es' });
  });
});
