/* Tools index: German and English texts with the shared language switch. */
import { applyTexts, bindLang, initTexts } from './shared/shell.js';

var TEXTS = {
  de: {
    heading: 'pr0game-Tools',
    toolsFor: 'Tools für',
    open: 'Öffnen →',
    flightTitle: 'Flugzeitrechner',
    flightText: 'Sekundengenaue Flugzeiten, Timing fürs Losschicken, Retime gegnerischer Flotten mit Verzögerung und Rückruf, Saven und Konter.',
    tagFlightTime: 'Flugzeit',
    tagRecall: 'Rückruf',
    lootTitle: 'AKS-Beuterechner',
    lootText: 'Beute und Trümmerfeld eines AKS aufteilen: ersetzt verlorene Schiffe und Deuterium, teilt den Gewinn gleich oder nach Investition und plant die Lieferungen.',
    tagAcs: 'AKS',
    tagLoot: 'Beute',
    tagDebris: 'Trümmerfeld',
    tagSharing: 'Aufteilen',
    hubText: 'Statistiken, Spionageberichte, Expeditionen und Galaxieseiten einfügen: Punkteveränderungen, Spio-Historie, Raid- und Expo-Statistiken, Deck-Zählung. Mit Login, Daten werden innerhalb deiner Allianz geteilt.',
    tagStats: 'Statistik',
    tagSpy: 'Spionageberichte',
    tagExpo: 'Expeditionen',
    tagAlliance: 'Allianz',
    soonTitle: 'Mehr folgt',
    soonText: 'Weitere Tools erscheinen hier.',
  },
  en: {
    heading: 'pr0game tools',
    toolsFor: 'Tools for',
    open: 'Open →',
    flightTitle: 'Flight Calculator',
    flightText: 'Second-accurate flight times, send timing, enemy retime with delay and recall, fleet save and counter-attacks.',
    tagFlightTime: 'flight time',
    tagRecall: 'recall',
    lootTitle: 'ACS Loot Calculator',
    lootText: 'Share the loot and debris of an ACS: covers lost ships and deuterium, splits the profit equally or by investment and plans the deliveries.',
    tagAcs: 'ACS',
    tagLoot: 'loot',
    tagDebris: 'debris',
    tagSharing: 'sharing',
    hubText: 'Paste stats, spy reports, expeditions and galaxy pages: point changes, spy history, raid and expo stats, deck counting. Login required, data is shared within your alliance.',
    tagStats: 'stats',
    tagSpy: 'spy reports',
    tagExpo: 'expeditions',
    tagAlliance: 'alliance',
    soonTitle: 'More to come',
    soonText: 'Further tools will show up here.',
  },
};

initTexts(TEXTS);
applyTexts();
bindLang();
