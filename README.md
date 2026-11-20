# Session YouTube

Extension Firefox qui transforme YouTube en sessions courtes et intentionnelles.

- **Sans session, YouTube est fermé.** Pour en ouvrir une : choisir le type de session, une durée (proposée ou libre), écrire ce qu'on vient faire (10 caractères minimum), puis attendre 10 secondes de réflexion. Si on quitte l'onglet pendant ce temps, le compte à rebours repart de zéro.
- **Types de session** :
  - *Shorts et vidéos* : tout est permis, selon les règles ci-dessous.
  - *Vidéos longues uniquement* : les shorts disparaissent (accueil, recherche, menu, onglets de chaîne). Un short ouvert par lien direct s'ouvre dans le lecteur classique, et il compte comme une vidéo.
- **Seules les vidéos qui tiennent dans le temps restant sont affichées** (accueil, recherche, barre latérale, écran de fin). Pour une vidéo déjà entamée, c'est le temps qu'il reste à regarder qui compte.
- **Une vidéo trop longue ouverte par lien direct** est mise en pause et masquée par un écran « hors session ».
- **La lecture automatique est désactivée.**
- **Shorts** : un short n'est jamais coupé. À moins de 2 minutes de la fin, le défilement reste possible : le short suivant est le dernier. Pendant celui-ci, rien n'apparaît en dessous et le défilement est bloqué. Il est lu en entier, même s'il dépasse la session, puis l'écran de fin s'affiche. Si le temps s'écoule avant d'avoir défilé, c'est le short en cours qui devient le dernier.
- **Fin de session** : un écran de clôture s'affiche avec une animation, l'intention de départ et des statistiques : la durée réelle de la session, le temps total depuis minuit (et le nombre de sessions), et le nombre de vidéos et/ou de shorts lancés. Il n'y a pas de bouton « encore 5 min ». Le lien « Ouvrir une nouvelle session » ramène au formulaire de démarrage complet (intention + temps de réflexion).
- **Langues** : anglais par défaut, français si Firefox est en français (`_locales/`).
- Une pastille en bas à gauche indique le temps restant, en minutes. Au survol, un bouton « Terminer » permet d'arrêter la session, après une confirmation dans la pastille. La popup de l'extension permet aussi de terminer la session plus tôt, sans confirmation.
- **Historique** : chaque session terminée est enregistrée localement (500 au maximum) avec son intention, sa durée et le nombre de vidéos et de shorts. L'écran de fin liste les sessions du jour. L'historique complet, groupé par jour, s'ouvre depuis l'écran de fin ou depuis la popup (« Historique »), et peut y être effacé.

## Réglages

Accessibles depuis la popup (lien « Réglages ») ou depuis `about:addons`.

- **Suggestions pendant une vidéo** :
  - *Seulement celles qui tiennent dans la session* (par défaut) : les suggestions trop longues disparaissent au fil de la session, et YouTube n'en charge pas d'autres pour les remplacer.
  - *Aucune suggestion* : rien à côté, sous ou à la fin de la vidéo.

## Installation (développement)

1. Ouvrir `about:debugging#/runtime/this-firefox` dans Firefox.
2. Cliquer sur **Charger un module complémentaire temporaire…**, puis choisir `manifest.json`.

Le module reste chargé jusqu'au redémarrage de Firefox.

## Règles de temps

- Le temps est compté à l'horloge : une pause dans une vidéo ne l'arrête pas.
- Quand le temps est écoulé alors qu'une vidéo est en cours, on la laisse se terminer. Elle dispose au maximum de 30 minutes supplémentaires. Si elle est mise en pause pendant ce temps, la session se termine.
- Si une vidéo se termine alors qu'il reste moins de 3 minutes, la session s'arrête aussitôt, sans laisser de temps mort.
- Les directs et les vidéos sans durée lisible restent affichés.

## Fichiers

- `src/shared.js` : constantes, types de messages et utilitaires communs à tous les scripts (objet `YS`).
- `src/theme.css` : palette de couleurs commune (variables `--ys-*`).
- `src/background.js` : état de la session, minuteur, clôture, bilan du jour et historique.
- `src/content/` : scripts injectés dans YouTube, chargés dans cet ordre (objet `YSC`) :
  - `core.js` : délais et seuils, état partagé, accès au lecteur ;
  - `styles.js` : styles des écrans et de la pastille ;
  - `filter.js` : filtrage des suggestions, masquage des Shorts en session « vidéos longues » ;
  - `shorts.js` : dernier short (masquage de la suite du fil, blocage du défilement) ;
  - `video.js` : suivi de la vidéo affichée (tient-elle dans le temps restant ?) ;
  - `overlays.js` : écrans de démarrage, de fin et « hors session » ;
  - `pill.js` : pastille de temps restant ;
  - `main.js` : point d'entrée, boucle de rafraîchissement.
- `src/content.css` : règles de masquage, pilotées par des classes et attributs posés par les scripts.
- `src/popup.*` : temps restant, bilan du jour et bouton d'arrêt anticipé.
- `src/stats.*` : page d'historique des sessions.
- `src/options.*` : réglages.
