# Session YouTube

Extension Firefox qui transforme YouTube en sessions courtes et intentionnelles.

- **Sans session, YouTube est fermé.** Pour en ouvrir une : choisir une durée, écrire ce qu'on vient faire (10 caractères minimum), puis attendre 10 secondes de réflexion. Si on quitte l'onglet pendant ce temps, le compte à rebours repart de zéro.
- **Seules les vidéos qui tiennent dans le temps restant sont affichées** (accueil, recherche, barre latérale, écran de fin). Pour une vidéo déjà entamée, c'est le temps qu'il reste à regarder qui compte.
- **Une vidéo trop longue ouverte par lien direct** est mise en pause et masquée par un écran « hors session ».
- **La lecture automatique est désactivée.**
- **Shorts** : un short n'est jamais coupé. À moins de 2 minutes de la fin, le défilement reste possible : le short suivant est le dernier. Pendant celui-ci, rien n'apparaît en dessous et le défilement est bloqué. Il est lu en entier, même s'il dépasse la session, puis l'écran de fin s'affiche. Si le temps s'écoule avant d'avoir défilé, c'est le short en cours qui devient le dernier.
- **Fin de session** : un écran de clôture s'affiche avec une animation, le bilan et l'intention de départ. Il n'y a pas de bouton « encore 5 min ». Le lien « Ouvrir une nouvelle session » ramène au formulaire de démarrage complet (intention + temps de réflexion).
- **Langues** : anglais par défaut, français si Firefox est en français (`_locales/`).
- Une pastille en bas à gauche indique le temps restant, en minutes. La popup de l'extension permet de terminer la session plus tôt.

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

- `src/background.js` : état de la session, minuteur et clôture.
- `src/content.js` : filtrage des suggestions, suivi de la vidéo et écrans (démarrage, fin, hors session).
- `src/popup.*` : temps restant et bouton d'arrêt anticipé.
