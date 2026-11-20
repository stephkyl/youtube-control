'use strict';

const { t } = YS;

document.documentElement.lang = YS.uiLang;
document.title = t('optionsPageTitle');
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);

const radios = [...document.querySelectorAll('input[name="watchSuggestions"]')];
const saved = document.getElementById('saved');
let settings = YS.withDefaultSettings();

browser.storage.local.get('settings').then((r) => {
  settings = YS.withDefaultSettings(r.settings);
  for (const radio of radios) radio.checked = radio.value === settings.watchSuggestions;
});

for (const radio of radios) {
  radio.addEventListener('change', async () => {
    settings = { ...settings, watchSuggestions: radio.value };
    await browser.storage.local.set({ settings });
    saved.textContent = t('optSaved');
  });
}
