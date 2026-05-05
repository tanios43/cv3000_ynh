# CV-3000 Interface — YunoHost Package

Interface web pour le réfracteur **Topcon CV-3000**, packagée pour [YunoHost](https://yunohost.org).

## Architecture

```
CV-3000 ──RS-232──► PC praticien (Chrome/Edge)
                           │
                    Web Serial API (JS)
                           │
                         HTTPS
                           │
                      YunoHost (Flask)
                    stockage historique
```

Le port série est lu **directement par le navigateur** via la [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API). Le serveur YunoHost ne touche pas au RS-232 — il sert juste l'interface et stocke l'historique.

## Prérequis

- **Chrome ou Edge ≥ 89** sur le poste du praticien
- CV-3000 branché sur ce poste (RS-232 ou adaptateur USB-série)
- HTTPS actif sur le domaine YunoHost (requis par Web Serial API)

## Fonctionnalités

| Fonction | Implémentation |
|---|---|
| Connexion port série | Web Serial API — sélecteur natif Chrome |
| Réception mesures | Parseur KB-1DS + STD1 en JavaScript |
| Détection format | Auto (KB-1DS → STD1) |
| Affichage OD/OS | Sphère, cylindre, axe, addition, PD |
| Envoi vers CV-3000 | Émulation KR/RM, trame STD1 |
| Copie prescription | `navigator.clipboard` |
| Historique | API REST Flask → `mesures.json` |
| Export CSV | Téléchargement direct |

## Installation

```bash
yunohost app install https://github.com/VOTRE_COMPTE/cv3000_ynh
```

## Licence

AGPL-3.0
