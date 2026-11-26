# TokkenMaxing

Tes limites Claude, **Session** (fenêtre de 5 h) et **Hebdo**, en direct, sous forme d'anneaux :

- **dans la barre des tâches Windows** : deux icônes, « S » et « H » ;
- **sur le téléphone** : une appli React Native (Expo) avec les mêmes anneaux, connectée directement à ton compte Claude, sans PC ;
- **sur l'écran d'accueil Samsung** : un widget Android avec les deux anneaux.

Le PC et le téléphone sont indépendants : chacun lit les chiffres chez Claude de son côté.

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

Les objectifs se règlent dans le tableau de bord Windows et dans l'appli (boutons − / +, par pas de 5). Chaque appareil garde les siens : ceux du téléphone valent pour l'appli et le widget, ceux du PC pour la barre des tâches et le tableau de bord.

La limite hebdo se réinitialise toutes les semaines à la même heure. Si Claude n'a pas encore donné la nouvelle heure (PC éteint pendant la réinitialisation, rien consommé depuis), l'appli la déduit de la précédente, +7 jours.

## D'où viennent les chiffres (Windows)

L'appli Windows interroge Claude toutes les 2 min, avec le même service que la commande `/usage` de Claude Code (`api.anthropic.com/api/oauth/usage`). Elle utilise pour cela le jeton de connexion que Claude Code a enregistré dans `%USERPROFILE%\.claude\.credentials.json`.

- Le jeton est **lu, jamais modifié ni renouvelé**. Le renouveler soi-même pourrait déconnecter Claude Code.
- Quand le jeton a expiré (il dure quelques heures), le tableau de bord l'indique. **Ouvre Claude Code** : il renouvelle le jeton et la lecture en direct reprend toute seule.
- En attendant, l'appli affiche la dernière copie que Claude Code a enregistrée dans `~/.claude.json` (`cachedUsageUtilization`), avec son heure.
- Ce service n'est pas documenté par Anthropic : il peut changer sans préavis, et utiliser ce jeton en dehors de Claude Code relève d'une zone grise des conditions d'utilisation.

## Windows

`dist/windows/TokkenMaxing.exe` (un seul fichier). Il nécessite le **.NET 9 Desktop Runtime**, déjà présent si le SDK .NET 9 est installé.

- **Clic gauche** sur un anneau : tableau de bord. On y trouve les deux grands anneaux avec l'heure de réinitialisation, le rythme (« 102 % de l'objectif », « Attendu maintenant : 43 % »), la répartition de la semaine (Cowork, Claude Code, chats), et les objectifs avec la légende des couleurs.
- Les icônes de la barre des tâches n'ont que la couleur, sans point blanc : à 16 px, il ne tiendrait pas sur l'anneau. La lettre passe en foncé sur les disques clairs.
- **Clic droit** : actualiser, choix des anneaux affichés dans la barre, démarrage avec Windows, dossier des réglages, quitter.
- Au premier lancement, les icônes sont placées directement sur la barre des tâches, pas dans le menu « ^ ». Cela ne s'applique que si tu n'as pas déjà fait un choix dans *Paramètres › Personnalisation › Barre des tâches › Autres icônes de la barre d'état système*.
- Les réglages sont stockés dans `%APPDATA%\TokkenMaxing\settings.json`.

## Téléphone (Android / Samsung)

L'appli se connecte **directement à ton compte Claude** : pas de PC, pas de Tailscale, pas de Wi-Fi commun. Ça marche partout où le téléphone a Internet.

1. Installe l'APK `dist/android/TokkenMaxing.apk`. Copie-le sur le téléphone et ouvre-le ; Android demandera d'autoriser l'installation depuis cette source. Avec le débogage USB activé, tu peux aussi lancer `adb install -r dist\android\TokkenMaxing.apk`.
2. Dans l'appli, touche **Se connecter à Claude**. La page Claude s'ouvre dans le navigateur du téléphone : connecte-toi si besoin (Google, e-mail…), puis autorise l'accès.
3. Claude affiche un **code**. Copie-le avec le bouton de la page et reviens dans l'appli : le code est repris tout seul depuis le presse-papiers. Sinon, touche **Coller** puis **Valider**.
4. Pour le widget, utilise **Ajouter le widget** dans l'appli, ou fais un appui long sur l'écran d'accueil › Widgets › TokkenMaxing.

C'est le même parcours que `claude /login` quand Claude Code ne peut pas ouvrir le navigateur lui-même (« colle le code »).

- Le téléphone obtient **sa propre connexion**, distincte de celle de Claude Code sur le PC. Il la renouvelle tout seul avant expiration, sans jamais déconnecter Claude Code. Si Claude finit par la refuser, l'appli et le widget te demandent de te reconnecter.
- Les jetons sont rangés dans le stockage chiffré d'Android (Keystore, via `expo-secure-store`), exclus des sauvegardes, et ne quittent le téléphone que vers Claude. **Se déconnecter** les efface.
- L'appli demande seulement les droits `user:profile` et `user:inference`, et ne s'en sert que pour lire `api.anthropic.com/api/oauth/usage`.
- L'appli lit Claude une fois par minute quand elle est ouverte (et à chaque retour dans l'appli, ou en tirant l'écran vers le bas), et pousse les valeurs vers le widget. Quand l'appli est fermée, Android limite les mises à jour du widget à une toutes les 30 min. **Touche un anneau du widget** pour l'actualiser immédiatement ; toucher le reste ouvre l'appli.
- Si Claude répond « trop de requêtes », l'appli attend le délai indiqué (2 min au moins) avant de réessayer.
- Comme pour Windows, ce service n'est pas documenté et l'appli utilise l'identifiant OAuth de Claude Code : même zone grise des conditions d'utilisation, et ça peut casser sans préavis.

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

- `TokkenMaxing.exe --dump report.json` interroge Claude une fois et écrit le rapport en JSON.
- `TokkenMaxing.exe --preview <dossier>` dessine le tableau de bord et les icônes en PNG, à partir du cache, sans appel réseau.
- `TokkenMaxing.exe --render-assets mobile\assets desktop\app.ico` régénère les icônes à partir du même code d'anneau.

## Architecture

```
desktop/   C# .NET 9 WinForms, sans dépendance externe
  PlanUsage.cs       lecture des limites (Claude en direct + cache de Claude Code), objectifs au rythme du temps, échelle de couleurs
  RingRenderer.cs    dessin de l'anneau (GDI+), thème clair ou sombre selon la barre des tâches
  TrayContext.cs     les deux icônes, menu, boucle d'actualisation, promotion Windows 11, démarrage auto
  PopupForm.cs       tableau de bord
mobile/    Expo SDK 58 / React Native 0.88
  src/oauth.ts                     connexion Claude, partie pure : URL d'autorisation PKCE, lecture du code collé
  src/claude.ts                    connexion et jetons (stockage sécurisé, renouvellement), lecture de l'utilisation
  src/report.ts                    réponse de Claude → anneaux (même lecture que PlanUsage.cs), réinitialisation hebdo projetée
  src/objective.ts                 le même calcul d'objectif et la même échelle de couleurs, refaits à l'affichage
  src/ring.ts                      le même anneau en SVG (géométrie identique, point blanc)
  App.tsx                          écran principal, carte « Compte Claude »
  src/widget/TokenRingWidget.tsx   widget (react-native-android-widget)
  src/widget/widgetTaskHandler.tsx mises à jour du widget, y compris appli fermée (il lit Claude lui-même)
```
