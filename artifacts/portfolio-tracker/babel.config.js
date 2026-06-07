module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          unstable_transformImportMeta: true,
          // Force the legacy Hermes transform profile that downlevels classes.
          // The default hermes-stable profile preserves classes, but the hermesc
          // AOT compiler (both local and EAS) rejects them.
          unstable_transformProfile: "hermes-v0",
        },
      ],
    ],
  };
};
