// Windows build fix: the New Architecture compiles library codegen (react-native-svg,
// safe-area-context…) with CMake, and object files end up with paths longer than 260
// characters, which the ninja shipped with the Android SDK cannot open
// ("Filename longer than 260 characters"). CMAKE_OBJECT_PATH_MAX makes CMake hash long
// object paths. The Android toolchain sets no limit by default, hence this plugin.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// tokkenmaxing: cmake-object-path-max';

module.exports = function withCmakeObjectPathMax(config, { max = 250 } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += `
${MARKER}
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=${max}"
            }
        }
    }
}
`;
    }
    return cfg;
  });
};
