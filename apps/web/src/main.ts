import { createApp } from 'vue';
import App from './App.vue';
import { currentLang, i18n, loadLocale } from './i18n';
import { registerWorker } from './push';
import { router } from './router';
import './style.css';

// the texts of the page language first (a chunk of their own); without them the app still starts
loadLocale(currentLang())
  .catch(() => {})
  .finally(() => createApp(App).use(i18n).use(router).mount('#app'));
registerWorker();
