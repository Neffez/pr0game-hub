<script lang="ts">
/** Line icons for the sidebar, drawn on a 24×24 grid (colour = currentColor). Paths are stroked, a leading "F:" fills the path instead. */
const ICONS: Record<string, string[]> = {
  // two circular arrows
  sync: ['M20 11a8 8 0 0 0-14.3-4.9L4 8', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.3 4.9L20 16', 'M20 20v-4h-4'],
  // bar chart (scores)
  overview: ['M3 20h18', 'M6 20v-8', 'M12 20V5', 'M18 20v-5'],
  // laurel wreath (Roman triumph); F: = filled leaf
  imperium: [
    'M11 19.1A7.2 7.2 0 0 1 8.4 5.8',
    'F:M8.2 18.1Q6 15.8 3.9 18.2Q6.1 20.4 8.2 18.1z',
    'F:M5.8 15.6Q4.9 12.6 1.9 13.6Q2.8 16.7 5.8 15.6z',
    'F:M4.8 12.3Q5.5 9.2 2.3 8.7Q1.7 11.8 4.8 12.3z',
    'F:M5.5 8.8Q7.6 6.4 5 4.6Q3 7 5.5 8.8z',
    'F:M7.8 6.2Q10.7 5 9.3 2.2Q6.4 3.3 7.8 6.2z',
    'M13 19.1A7.2 7.2 0 0 0 15.6 5.8',
    'F:M15.8 18.1Q17.9 20.4 20.1 18.2Q18 15.8 15.8 18.1z',
    'F:M18.2 15.6Q21.2 16.7 22.1 13.6Q19.1 12.6 18.2 15.6z',
    'F:M19.2 12.3Q22.3 11.8 21.7 8.7Q18.5 9.2 19.2 12.3z',
    'F:M18.5 8.8Q21 7 19 4.6Q16.4 6.4 18.5 8.8z',
    'F:M16.2 6.2Q17.6 3.3 14.7 2.2Q13.3 5 16.2 6.2z',
  ],
  // podium (rankings)
  stats: ['M3 20.5h18', 'M9 20.5V8.5h6v12', 'M3 20.5v-7h6', 'M15 20.5v-4.5h6', 'M12 3.5v2'],
  // sun with orbit and planet
  galaxy: ['M14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0', 'M9.3 4.5A8 8 0 1 1 4.5 9.3', 'M8 6.3a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0'],
  // eye
  spy: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0'],
  // shield with exclamation mark
  hostile: ['M12 3l7.5 3v5.5c0 4.4-3.1 7.9-7.5 9.5-4.4-1.6-7.5-5.1-7.5-9.5V6z', 'M12 8v4.5', 'M12 16v.01'],
  // pulse line
  activity: ['M3 12h4l3-7 4 14 3-7h4'],
  // clock
  freshness: ['M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0', 'M12 7v5l3.5 2'],
  // ringed planet
  planets: ['M17.2 12a5.2 5.2 0 1 1-10.4 0a5.2 5.2 0 1 1 10.4 0', 'M16.4 7.6A10 3 -22 1 1 5.8 11.9'],
  // rocket
  fleet: [
    'M12 2.5c2.8 2.3 4.3 5.6 4.3 9.5v5H7.7v-5c0-3.9 1.5-7.2 4.3-9.5z',
    'M7.7 13 5 16v3h2.7',
    'M16.3 13l2.7 3v3h-2.7',
    'M10.5 21h3',
    'M13.5 10a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0',
  ],
  // bell (notifications)
  bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 1.8H4.2z', 'M10 21a2.2 2.2 0 0 0 4 0'],
  // flask
  research: ['M9 3h6', 'M10 3v6l-5.6 9.6A1.6 1.6 0 0 0 5.8 21h12.4a1.6 1.6 0 0 0 1.4-2.4L14 9V3', 'M7 15h10'],
  // crosshair
  raids: ['M20 12a8 8 0 1 1-16 0a8 8 0 1 1 16 0', 'M12 2v5', 'M12 17v5', 'M2 12h5', 'M17 12h5', 'M12 12v.01'],
  // flag planted on a target (claimed targets)
  targets: ['M5 21V4', 'M5 4h12l-2.5 4 2.5 4H5'],
  // trophy
  battleHall: ['M8 3.5h8V9a4 4 0 0 1-8 0z', 'M8 5.5H5v1a3 3 0 0 0 3 3', 'M16 5.5h3v1a3 3 0 0 1-3 3', 'M12 13v4', 'M8.5 21l1-4h5l1 4z'],
  // compass
  expeditions: ['M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0', 'M15.5 8.5l-2 5-5 2 2-5z'],
  // envelope
  messages: ['M3.5 6.5h17v11h-17z', 'M3.5 6.5 12 13l8.5-6.5'],
  // two cards
  deck: ['M8.5 3h9.5a2 2 0 0 1 2 2v12', 'M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'],
  // four tiles
  universes: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  // sliders
  admin: [
    'M4 6h8', 'M16 6h4', 'M16 6a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
    'M4 12h2', 'M10 12h10', 'M10 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
    'M4 18h10', 'M18 18h2', 'M18 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
  ],
  // star (what's new)
  changelog: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
  // three lines (menu)
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  // person
  user: ['M16 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0', 'M4.5 21a7.5 7.5 0 0 1 15 0'],
};

export type IconName = keyof typeof ICONS;
export { ICONS };
</script>

<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <svg
    class="nav-icon"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-for="d in ICONS[name]" :key="d">
      <path v-if="d.startsWith('F:')" :d="d.slice(2)" fill="currentColor" stroke="none" />
      <path v-else :d="d" />
    </template>
  </svg>
</template>
