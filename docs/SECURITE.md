# Sécurité, déploiement et durcissement

Ce document décrit la posture de sécurité par défaut de Météo Analyse, la procédure
de déploiement, et la marche à suivre pour ouvrir l'application au réseau **avec**
authentification et TLS.

## 1. Posture par défaut

| Élément | Comportement par défaut |
| --- | --- |
| Interface d'écoute | `127.0.0.1` uniquement (`HOST` non défini) |
| Authentification | désactivée (inutile en local), aucune route protégée |
| Exposition réseau | impossible sans configuration explicite |
| Refus de démarrage | `HOST` non local **sans** authentification → code de sortie `1` |
| Rate limiting | 120 req/min par IP sur `/api`, 10 req/min sur `/api/auth/login` |
| Force brute | 5 échecs en 15 min → verrouillage 15 min par IP |
| En-têtes | `helmet` (CSP stricte, HSTS, `Referrer-Policy: no-referrer`, `X-Frame-Options`) |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure` si la requête est en HTTPS |
| Secrets | uniquement via variables d'environnement, jamais dans le dépôt |

Conséquence : tant que `HOST` reste à `127.0.0.1`, l'application n'est joignable
que depuis la machine. Aucun port n'est exposé sur Internet.

## 2. Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3000` | port HTTP |
| `HOST` | `127.0.0.1` | interface d'écoute |
| `AUTH_USERNAME` | — | identifiant de connexion |
| `AUTH_PASSWORD_HASH` | — | hash scrypt `scrypt$N$r$p$sel$empreinte` |
| `SESSION_SECRET` | — | clé HMAC des sessions (≥ 32 caractères) |
| `SESSION_TTL_HOURS` | `12` | durée de vie d'une session (1–168) |
| `TRUST_PROXY` | — | réglage Express `trust proxy` (ex. `1` derrière un proxy) |

Les trois variables `AUTH_*` / `SESSION_SECRET` vont **ensemble** : en définir une
seule partie fait échouer le démarrage avec un message explicite.

## 3. Générer les secrets

```bash
printf '%s' 'un-mot-de-passe-long-et-unique' | npm run auth:hash
```

La commande affiche les trois lignes à coller dans `.env` :

```
AUTH_USERNAME=meteo
AUTH_PASSWORD_HASH=scrypt$16384$8$1$...
SESSION_SECRET=...
```

Le mot de passe est lu sur l'entrée standard : il n'apparaît ni dans l'historique
du shell ni dans la liste des processus. Le hash est calculé avec scrypt
(N=16384, r=8, p=1) et un sel aléatoire de 16 octets ; la vérification est faite
en temps constant.

**Recommandations** : mot de passe ≥ 16 caractères, unique, généré par un
gestionnaire de mots de passe. Le fichier `.env` est ignoré par Git — ne jamais
committer de secret, ne jamais le transmettre par chat ou par e-mail.

## 4. Partager l'application sur le réseau (LAN) avec authentification

1. Générer les secrets (section 3) et les placer dans `.env`.
2. Choisir l'interface d'écoute :

   ```bash
   # Toutes les interfaces (nécessaire pour Docker, ou pour joindre l'hôte par son IP)
   HOST=0.0.0.0
   # ou une IP précise du réseau local
   # HOST=192.168.1.20
   ```

3. Démarrer :

   ```bash
   npm run build
   PORT=3000 HOST=0.0.0.0 npm start
   ```

   Le journal affiche `[securite] HOST=0.0.0.0 : authentification active…`.

4. Depuis une autre machine : `http://192.168.1.20:3000` affiche l'écran de
   connexion ; `/api/health` reste public (supervision).

5. Autoriser uniquement le port dans le pare-feu, et seulement pour le
   sous-réseau concerné :

   ```powershell
   # Windows (PowerShell, en administrateur) — restreindre au sous-réseau local
   New-NetFirewallRule -DisplayName "Meteo 3000 LAN" -Direction Inbound -Protocol TCP `
     -LocalPort 3000 -RemoteAddress 192.168.1.0/24 -Action Allow
   ```

   ```bash
   # Linux (ufw)
   sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
   ```

Sans HTTPS sur un réseau non maîtrisé, le mot de passe circule en clair : pour
tout partage au-delà d'un réseau de confiance, passer par la section 5.

## 5. Reverse proxy HTTPS (obligatoire pour toute exposition Internet)

Le serveur reste en HTTP sur la boucle locale ; seul le proxy écoute sur
Internet et termine le TLS.

### 5.1 Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name meteo.example.org;

    ssl_certificate     /etc/letsencrypt/live/meteo.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meteo.example.org/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;

    client_max_body_size 32k;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name meteo.example.org;
    return 301 https://$host$request_uri;
}
```

Côté application, **`TRUST_PROXY=1` est indispensable** : sans lui, Express voit
l'IP du proxy (donc un seul compteur de rate limiting pour tout le monde) et
`req.secure` reste faux, ce qui empêche l'attribut `Secure` sur le cookie.

```bash
PORT=3000 HOST=127.0.0.1 TRUST_PROXY=1 npm start
```

### 5.2 Caddy (TLS automatique)

```caddyfile
meteo.example.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-Proto {scheme}
    }
}
```

### 5.3 Docker

```bash
docker build -t meteo-analyse .
docker run --rm \
  -p 127.0.0.1:3000:3000 \
  -e AUTH_USERNAME=meteo \
  -e AUTH_PASSWORD_HASH='scrypt$...' \
  -e SESSION_SECRET='...' \
  meteo-analyse
```

Le préfixe `127.0.0.1` empêche l'exposition directe du conteneur : seul le proxy
sur l'hôte peut le joindre. Ne jamais publier `-p 3000:3000` sur une machine
connectée à Internet.

## 6. Ce qui est protégé, et comment

| Menace | Mesure |
| --- | --- |
| Accès non autorisé | session signée HMAC-SHA256, expiration, cookie `HttpOnly` + `SameSite=Strict` |
| Vol de session par XSS | cookie inaccessible au JavaScript, CSP `script-src 'self'` |
| CSRF | `SameSite=Strict` + `Content-Type: application/json` exigé sur la connexion |
| Force brute | 5 échecs / 15 min → verrouillage 15 min par IP, réponse `429` + `Retry-After` |
| Déni de service applicatif | 120 req/min par IP, 10 req/min sur la connexion, corps JSON ≤ 16 ko |
| Fuite d'information | erreurs `5xx` sans pile d'exécution, `x-powered-by` désactivé |
| Interception du mot de passe | TLS terminé par le proxy, HSTS, `Secure` sur le cookie |
| Fuite de secrets | uniquement par variables d'environnement, `.env` ignoré par Git |

## 7. Limites connues

- **Sessions non révocables individuellement** : le jeton est stateless. Changer
  `SESSION_SECRET` invalide toutes les sessions d'un coup ; il n'existe pas de
  « déconnecter tous les autres appareils ».
- **Compteurs en mémoire** : par défaut, le rate limiting est local à l'instance.
  Définir `REDIS_URL` partage les compteurs (et le cache) entre instances ; le
  verrouillage anti-force brute reste, lui, local à chaque instance.
- **Un seul compte** : pas de rôles, pas de 2FA, pas de gestion multi-utilisateurs.
- **Pas de journal d'audit persistant** : seules les erreurs `5xx` sont journalisées.
- **Pas de révocation de mot de passe à chaud** : modifier `AUTH_PASSWORD_HASH`
  exige un redémarrage.

## 8. Checklist avant exposition

- [ ] `HOST` explicitement défini, jamais `0.0.0.0` sans authentification.
- [ ] `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET` générés et stockés hors dépôt.
- [ ] Reverse proxy TLS devant l'application, `TRUST_PROXY=1` côté Node.
- [ ] Pare-feu : seul le port `443` (et `80` pour la redirection) est ouvert.
- [ ] Port `3000` lié à `127.0.0.1`, non joignable depuis Internet.
- [ ] `curl -I https://…/api/health` → `200`, en-têtes HSTS présents.
- [ ] `curl -i https://…/api/weather?...` → `401` sans session.
- [ ] Connexion valide → cookie `HttpOnly`, `Secure`, `SameSite=Strict`.
- [ ] 5 tentatives erronées → `429` avec `Retry-After`.
- [ ] Sauvegarde et rotation du secret planifiées.

## 9. Vérifications après déploiement

```bash
# Santé publique
curl -s http://127.0.0.1:3000/api/health

# Refus sans session (attendu : 401)
curl -i http://127.0.0.1:3000/api/weather?latitude=-18.8792&longitude=47.5079

# Connexion et usage authentifié
curl -c cookies.txt -H 'content-type: application/json' \
  -d '{"username":"meteo","password":"…"}' \
  http://127.0.0.1:3000/api/auth/login

curl -b cookies.txt \
  'http://127.0.0.1:3000/api/weather?latitude=-18.8792&longitude=47.5079'
```

Le pipeline Dagster (`dagster_project/`) n'est pas concerné par cette
application : son UI écoute sur le port `3001` (l'application Node occupe
`3000`). Ne pas l'exposer au réseau et la laisser sur l'interface locale.
