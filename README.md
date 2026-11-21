# TokkenMaxing

Tes limites Claude, **Session** (fenêtre de 5 h) et **Hebdo**, en direct, sous forme d'anneaux :

- **dans la barre des tâches Windows** : deux icônes, « S » et « H » ;
- **sur le téléphone** : une appli React Native (Expo) avec les mêmes anneaux ;
- **sur l'écran d'accueil Samsung** : un widget Android avec les deux anneaux.

Les pourcentages sont ceux que Claude affiche lui-même (paramètres d'utilisation sur claude.ai, `/usage` dans Claude Code). Ils incluent tout ce qui consomme ton abonnement : Cowork, Claude Code et les chats.

## Lire l'anneau

| Élément | Signification |
| --- | --- |
| Contour | % de la limite utilisée (session ou semaine), dans le sens horaire depuis midi |
| Point blanc (tableau de bord, appli, widget) | Où tu devrais en être **maintenant** pour atteindre ton objectif pile à la réinitialisation |
| Couleur du disque | Ta conso comparée au point blanc, de 0 % à 200 % de l'objectif du moment (voir ci-dessous) |

### Objectifs

Chaque anneau a un objectif : le % de la limite à avoir utilisé au moment de la réinitialisation. Par défaut, il est de **100 %** pour les deux anneaux : tout utiliser, au rythme du temps qui passe.

L'objectif du moment avance avec le temps : *objectif × part écoulée de la fenêtre* (5 h pour la session, 7 jours pour la semaine). Exemple : la limite hebdo se réinitialise le samedi à 08:00 et l'objectif est de 100 %. Le mardi à 08:00, 3 jours sur 7 sont passés : tu devrais en être à 3/7 ≈ 43 %. Le point blanc est alors à 43 % du tour.

Le disque se colore selon *conso ÷ objectif du moment* :

| 0 % | 25 % | 50 % | 75 % | **100 %** | 125 % | 150 % | 175 % | 200 % et + |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `#313695` | `#4575b4` | `#74add1` | `#66c2a5` | **`#1a9850`** | `#a6d96a` | `#fdd835` | `#f46d43` | `#a50026` |

Les teintes intermédiaires sont interpolées. Côté bleu, tu consommes moins vite que prévu (quota qui risque d'être perdu) ; côté rouge, plus vite (tu toucheras la limite avant la réinitialisation). Entre 90 % et 110 %, l'appli affiche « Dans le rythme ».

Les objectifs se règlent dans le tableau de bord Windows ou dans l'appli (boutons − / +, par pas de 5). Ils sont stockés sur le PC, donc la barre des tâches, l'appli et le widget affichent toujours les mêmes.

La limite hebdo se réinitialise toutes les semaines à la même heure. Si Claude n'a pas encore donné la nouvelle heure (PC éteint pendant la réinitialisation, rien consommé depuis), l'appli la déduit de la précédente, +7 jours.

## D'où viennent les chiffres

L'appli Windows interroge Claude toutes les 2 min, avec le même service que la commande `/usage` de Claude Code (`api.anthropic.com/api/oauth/usage`). Elle utilise pour cela le jeton de connexion que Claude Code a enregistré dans `%USERPROFILE%\.claude\.credentials.json`.

- Le jeton est **lu, jamais modifié ni renouvelé**. Le renouveler soi-même pourrait déconnecter Claude Code.
- Quand le jeton a expiré (il dure quelques heures), le tableau de bord l'indique. **Ouvre Claude Code** : il renouvelle le jeton et la lecture en direct reprend toute seule.
- En attendant, l'appli affiche la dernière copie que Claude Code a enregistrée dans `~/.claude.json` (`cachedUsageUtilization`), avec son heure.
- Ce service n'est pas documenté par Anthropic : il peut changer sans préavis, et utiliser ce jeton en dehors de Claude Code relève d'une zone grise des conditions d'utilisation.

## Windows

`dist/windows/TokkenMaxing.exe` (un seul fichier). Il nécessite le **.NET 9 Desktop Runtime**, déjà présent si le SDK .NET 9 est installé.

- **Clic gauche** sur un anneau : tableau de bord. On y trouve les deux grands anneaux avec l'heure de réinitialisation, le rythme (« 102 % de l'objectif », « Attendu maintenant : 43 % »), la répartition de la semaine (Cowork, Claude Code, chats), les objectifs avec la légende des couleurs, et la connexion téléphone.
- Les icônes de la barre des tâches n'ont que la couleur, sans point blanc : à 16 px, il ne tiendrait pas sur l'anneau. La lettre passe en foncé sur les disques clairs.
- **Clic droit** : actualiser, choix des anneaux affichés dans la barre, partage, démarrage avec Windows, pare-feu, quitter.
- Au premier lancement, les icônes sont placées directement sur la barre des tâches, pas dans le menu « ^ ». Cela ne s'applique que si tu n'as pas déjà fait un choix dans *Paramètres › Personnalisation › Barre des tâches › Autres icônes de la barre d'état système*.
- Les réglages sont stockés dans `%APPDATA%\TokkenMaxing\settings.json`.

## Téléphone (Android / Samsung)

1. Installe l'APK `dist/android/TokkenMaxing.apk`. Copie-le sur le téléphone et ouvre-le ; Android demandera d'autoriser l'installation depuis cette source. Avec le débogage USB activé, tu peux aussi lancer `adb install dist\android\TokkenMaxing.apk`.
2. Pour joindre le PC **de partout** (4G, autre Wi-Fi), installe [Tailscale](https://tailscale.com) sur le PC et sur le téléphone, connectés au même compte. Sans Tailscale, le téléphone doit être sur le même Wi-Fi que le PC.
3. Sur le PC, autorise le port dans le pare-feu, une seule fois. Passe par le lien du tableau de bord *Téléphone bloqué ? Autoriser dans le pare-feu…*, ou lance dans un terminal administrateur :
   ```
   netsh advfirewall firewall add rule name="TokkenMaxing (TCP 7420)" dir=in action=allow protocol=TCP localport=7420 profile=private
   netsh advfirewall firewall add rule name="TokkenMaxing Tailscale (TCP 7420)" dir=in action=allow protocol=TCP localport=7420 remoteip=100.64.0.0/10 profile=any
   ```
   La seconde règle n'accepte que tes appareils Tailscale (adresses `100.64.0.0/10`), quel que soit le réseau.
4. Dans l'appli, saisis l'**adresse** et le **code** affichés en bas du tableau de bord Windows. Quand Tailscale tourne sur le PC, le tableau de bord affiche son adresse Tailscale (`http://100.x.y.z:7420 · Tailscale`), qui marche partout ; l'adresse Wi-Fi reste dans l'infobulle.

Avec Tailscale, le PC doit rester allumé avec TokkenMaxing lancé, et Tailscale doit être actif sur le téléphone. Android n'accepte qu'un VPN actif à la fois. Le trafic entre tes deux appareils est chiffré par Tailscale, et rien n'est exposé sur Internet.
5. Pour le widget, utilise **Ajouter le widget** dans l'appli, ou fais un appui long sur l'écran d'accueil › Widgets › TokkenMaxing.

La carte **Objectifs** de l'appli règle les objectifs du PC (il faut que le PC soit joignable).

Le téléphone ne parle qu'au PC, jamais directement à Claude, et le jeton ne quitte pas le PC. L'appli se met à jour toutes les 5 s quand elle est ouverte, et pousse aussi les valeurs vers le widget. Quand l'appli est fermée, Android limite les mises à jour du widget à une toutes les 30 min. **Touche un anneau du widget** pour l'actualiser immédiatement ; toucher le reste ouvre l'appli.

## Compiler

```powershell
# Windows
cd desktop
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:DebugType=none -o ..\dist\windows

# Android : APK release (signé avec la clé de debug, suffisant pour l'installer soi-même)
cd mobile
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Sous Windows, le ninja fourni avec le SDK Android ne sait pas ouvrir les chemins de plus de 260 caractères, et React Native 0.88 en produit en compilant le C++. Le plugin `mobile/plugins/withCmakeObjectPathMax.js` passe `-DCMAKE_OBJECT_PATH_MAX=250` à CMake, qui raccourcit alors ces chemins (ne pas descendre à 200 : le hachage ne se déclenche plus). Ne modifie pas `mobile/android/` à la main : ce dossier est régénéré par `expo prebuild`.

Outils intégrés à l'exe :

- `TokkenMaxing.exe --dump report.json` interroge Claude une fois et écrit le JSON envoyé au téléphone.
- `TokkenMaxing.exe --preview <dossier>` dessine le tableau de bord et les icônes en PNG, à partir du cache, sans appel réseau.
- `TokkenMaxing.exe --render-assets mobile\assets desktop\app.ico` régénère les icônes à partir du même code d'anneau.

## Architecture

```
desktop/   C# .NET 9 WinForms, sans dépendance externe
  PlanUsage.cs       lecture des limites (Claude en direct + cache de Claude Code), objectifs au rythme du temps, échelle de couleurs
  RingRenderer.cs    dessin de l'anneau (GDI+), thème clair ou sombre selon la barre des tâches
  TrayContext.cs     les deux icônes, menu, boucle d'actualisation, promotion Windows 11, démarrage auto
  PopupForm.cs       tableau de bord
  ApiServer.cs       mini serveur HTTP sur le réseau local (port 7420) : lecture, et réglage des objectifs
mobile/    Expo SDK 58 / React Native 0.88
  src/objective.ts                 le même calcul d'objectif et la même échelle de couleurs, refaits à l'affichage
  src/ring.ts                      le même anneau en SVG (géométrie identique, point blanc)
  App.tsx                          écran principal
  src/widget/TokenRingWidget.tsx   widget (react-native-android-widget)
  src/widget/widgetTaskHandler.tsx mises à jour du widget, y compris appli fermée
```

API du PC : `GET /api/ping` (sans code), `GET /api/usage` et `POST /api/targets?session=80&weekly=100` (en-tête `Authorization: Bearer <code>`, ou `?code=`). Le JSON (version 3) contient `limits` (session et hebdo : `percent`, `resetsAt`, `pace` = part écoulée, `target` = objectif, `expected` = objectif du moment, `ratio`, `marker` = position du point blanc, `status` = `under` / `on_track` / `over` / `idle`, `color`), `breakdown` (répartition de la semaine), la source (`live` ou `cache`) et l'éventuel problème de lecture. `POST /api/targets` renvoie le même JSON, avec les nouveaux objectifs déjà appliqués.
