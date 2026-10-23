import { createApp } from 'vue';
import App from './App.vue';
import { i18n } from './i18n';
import { registerWorker } from './push';
import { router } from './router';
import './style.css';

createApp(App).use(i18n).use(router).mount('#app');
registerWorker();
