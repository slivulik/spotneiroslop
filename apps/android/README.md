# Sonora для Android

Нативное приложение: Kotlin, Jetpack Compose (Material 3), Media3 (ExoPlayer + HLS + MediaSessionService),
Room, DataStore, Hilt, Retrofit + kotlinx.serialization, Coil. WebView не используется.

## Что умеет
- Вход тем же аккаунтом, что и на сайте; токены обновляются автоматически.
- Главная (Моя волна, блоки из админки), поиск (подсказки по мере ввода, история, популярное, сортировка),
  медиатека (плейлисты, любимые треки, альбомы, артисты, история), страницы альбома, артиста, плейлиста,
  микса и жанра.
- Фоновое воспроизведение: уведомление, экран блокировки, кнопки гарнитуры/Bluetooth, аудиофокус,
  пауза при отключении наушников, восстановление очереди после перезапуска.
- Очередь (следующим / в конец / убрать / перейти), перемешивание, повтор, тексты с подсветкой строки.
- Кэш сегментов аудио (LRU, размер в настройках), кэш обложек, офлайн-копия экранов,
  очередь событий прослушивания (уходит на сервер, когда появится сеть).
- Настройки синхронизируются с веб-версией: тема, качество для Wi-Fi и мобильной сети,
  выравнивание громкости, 10-полосный эквалайзер (переносится на эквалайзер телефона).

## Сборка
Нужны JDK 17 и Android SDK (Android Studio Ladybug или новее ставит всё сам).

```bash
cd apps/android
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew bundleRelease          # app/build/outputs/bundle/release/app-release.aab
./gradlew testDebugUnitTest      # юнит-тесты
```

Адрес сервера по умолчанию — `http://2.26.2.127:8080`; другой можно задать при сборке
(`./gradlew assembleDebug -PsonoraBaseUrl=https://music.example.com`) или в приложении: Настройки → Сервер.
HTTP без TLS разрешён только для этого IP, эмулятора (10.0.2.2) и localhost (`res/xml/network_security_config.xml`).

Подпись релиза берётся из переменных окружения `SONORA_KEYSTORE`, `SONORA_KEYSTORE_PASSWORD`,
`SONORA_KEY_ALIAS`, `SONORA_KEY_PASSWORD`; без них релизная сборка получается неподписанной.

GitHub Actions (`.github/workflows/android.yml`) на каждый push в `apps/android` запускает тесты,
lint и собирает APK и AAB — их можно скачать в артефакте `sonora-android` у запуска workflow.

## Дизайн-токены
`app/src/main/java/com/sonora/app/core/designsystem/tokens/SonoraTokens.kt` генерируется из
`packages/design-tokens/tokens.json` (`pnpm --filter @sonora/design-tokens build`) и копируется сюда;
CI проверяет, что копия совпадает. Шрифты Unbounded и Onest (OFL, лицензии в `licenses/`)
собраны в TTF из тех же файлов, что использует сайт.
