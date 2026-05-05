## Navigateur requis

Cette application utilise la **Web Serial API**, disponible uniquement dans **Chrome** et **Edge** (version ≥ 89). Firefox n'est pas supporté.

## Connexion série

Au premier clic sur "Connecter le port série", le navigateur affiche une fenêtre native de sélection de port. Sélectionnez le port correspondant au CV-3000 (ex : `COM3` sous Windows, `/dev/ttyUSB0` sous Linux).

Le HTTPS est obligatoire pour que Web Serial API fonctionne — YunoHost le gère automatiquement via Let's Encrypt.

## Sécurité

Restreignez l'accès à l'application aux utilisateurs autorisés via les permissions YunoHost. Les données de réfraction sont des données médicales sensibles.
