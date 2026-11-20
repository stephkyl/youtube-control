'use strict';

const t = (key) => browser.i18n.getMessage(key);
document.documentElement.lang = browser.i18n.getUILanguage();
document.title = t('optionsPageTitle');
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);

const DEFAULT_SETTINGS = { watchSuggestions: 'fit' };
const radios = [...document.querySelectorAll('input[name="watchSuggestions"]')];
const saved = document.getElementById('saved');
let settings = { ...DEFAULT_SETTINGS };

browser.storage.local.get('settings').then((r) => {
  settings = { ...DEFAULT_SETTINGS, ...r.settings };
  for (const r of radios) r.checked = r.value === settings.watchSuggestions;
});

for (const radio of radios) {
  radio.addEventListener('change', async () => {
    settings = { ...settings, watchSuggestions: radio.value };
    await browser.storage.local.set({ settings });
    saved.textContent = t('optSaved');
  });
}
