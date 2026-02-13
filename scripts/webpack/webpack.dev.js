'use strict';
const { getPackagesSync } = require('@manypkg/get-packages');
const browserslist = require('browserslist');
const { resolveToEsbuildTarget } = require('esbuild-plugin-browserslist');
const ESLintPlugin = require('eslint-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const fs = require('fs');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const path = require('path');
const { DefinePlugin, EnvironmentPlugin } = require('webpack');
const WebpackAssetsManifest = require('webpack-assets-manifest');
const LiveReloadPlugin = require('webpack-livereload-plugin');
const { merge } = require('webpack-merge');
const WebpackBar = require('webpackbar');

const getEnvConfig = require('./env-util.js');
const common = require('./webpack.common.js');
const esbuildTargets = resolveToEsbuildTarget(browserslist(), { printUnknownTargets: false });
// esbuild-loader 3.0.0+ requires format to be set to prevent it
// from defaulting to 'iife' which breaks monaco/loader once minified.
const esbuildOptions = {
  target: esbuildTargets,
  format: undefined,
  jsx: 'automatic',
};

// To speed up webpack and prevent unnecessary rebuilds we ignore decoupled packages
function getDecoupledPlugins() {
  const { packages } = getPackagesSync(process.cwd());
  return packages.filter((pkg) => pkg.dir.includes('plugins/datasource')).map((pkg) => `${pkg.dir}/**`);
}

// When linking scenes for development, resolve directly to the CJS dist entry.
// The ESM build (dist/esm) has a rollup preserveModules bug that drops the
// performanceUtils namespace export, so we force webpack to use the CJS build
// which bundles everything correctly.
// Run `yarn build` in the scenes package before starting Grafana.
function scenesModule() {
  const scenesPath = path.resolve('./node_modules/@grafana/scenes');
  try {
    const status = fs.lstatSync(scenesPath);
    if (status.isSymbolicLink()) {
      const cjsEntry = path.resolve(scenesPath, 'dist/index.js');
      console.log(`scenes is linked to local scenes repo (using CJS dist: ${cjsEntry})`);
      return cjsEntry;
    }
  } catch (error) {
    console.error(`Error checking scenes path: ${error.message}`);
  }
  return scenesPath;
}

const envConfig = getEnvConfig();

module.exports = (env = {}) => {
  return merge(common, {
    devtool: 'source-map',
    mode: 'development',

    entry: {
      app: './public/app/index.ts',
      dark: './public/sass/grafana.dark.scss',
      light: './public/sass/grafana.light.scss',
    },

    // If we enabled watch option via CLI
    watchOptions: {
      ignored: ['/node_modules/', ...getDecoupledPlugins()],
    },

    resolve: {
      alias: {
        // Packages linked for development need react to be resolved from the same location
        react: path.resolve('./node_modules/react'),

        // This is required to correctly resolve react-router-dom when linking with
        //  local version of @grafana/scenes
        'react-router-dom': path.resolve('./node_modules/react-router-dom'),

        // Ensure linked scenes uses Grafana's rxjs to avoid duplicate instance type mismatches
        rxjs: path.resolve('./node_modules/rxjs'),

        // Ensure linked scenes resolves @grafana/* packages from Grafana's node_modules
        // to avoid duplicate module instances (different React contexts, etc.).
        // The `$` suffix = exact match only, so @grafana/ui/internal still resolves normally.
        // @grafana/schema has NO `$` so deep subpath imports (e.g. /src/raw/...) also redirect.
        '@grafana/schema': path.resolve('./node_modules/@grafana/schema'),
        '@grafana/data$': path.resolve('./node_modules/@grafana/data'),
        '@grafana/runtime$': path.resolve('./node_modules/@grafana/runtime'),
        '@grafana/ui$': path.resolve('./node_modules/@grafana/ui'),
        '@grafana/e2e-selectors$': path.resolve('./node_modules/@grafana/e2e-selectors'),
        '@emotion/react$': path.resolve('./node_modules/@emotion/react'),

        '@grafana/scenes': scenesModule(),
      },
    },

    module: {
      // Note: order is bottom-to-top and/or right-to-left
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'esbuild-loader',
            options: esbuildOptions,
          },
        },
        require('./sass.rule.js')({
          sourceMap: false,
          preserveUrl: true,
        }),
      ],
    },

    // infrastructureLogging: { level: 'error' },

    // https://webpack.js.org/guides/build-performance/#output-without-path-info
    output: {
      pathinfo: false,
    },

    // https://webpack.js.org/guides/build-performance/#avoid-extra-optimization-steps
    optimization: {
      moduleIds: 'named',
      runtimeChunk: true,
      removeAvailableModules: false,
      removeEmptyChunks: false,
      splitChunks: false,
    },

    // enable persistent cache for faster cold starts
    cache: {
      type: 'filesystem',
      name: 'grafana-default-development',
      buildDependencies: {
        config: [__filename],
      },
    },

    plugins: [
      ...(parseInt(env.liveReload, 10)
        ? [
            new LiveReloadPlugin({
              appendScriptTag: true,
              useSourceHash: true,
              hostname: 'localhost',
              protocol: 'http',
              port: 35750,
            }),
          ]
        : []),
      parseInt(env.noTsCheck, 10)
        ? new DefinePlugin({}) // bogus plugin to satisfy webpack API
        : new ForkTsCheckerWebpackPlugin({
            async: true, // don't block webpack emit
            typescript: {
              mode: 'write-references',
              memoryLimit: 5096,
              diagnosticOptions: {
                semantic: true,
                syntactic: true,
              },
            },
          }),
      parseInt(env.noLint, 10)
        ? new DefinePlugin({}) // bogus plugin to satisfy webpack API
        : new ESLintPlugin({
            cache: true,
            lintDirtyModulesOnly: true, // don't lint on start, only lint changed files
            extensions: ['.ts', '.tsx'],
            configType: 'flat',
            failOnError: false,
          }),
      new MiniCssExtractPlugin({
        filename: 'grafana.[name].[contenthash].css',
      }),
      new DefinePlugin({
        'process.env': {
          NODE_ENV: JSON.stringify('development'),
        },
      }),
      new WebpackAssetsManifest({
        entrypoints: true,
        integrity: true,
        integrityHashes: ['sha384', 'sha512'],
        publicPath: true,
      }),
      new WebpackBar({
        color: '#eb7b18',
        name: 'Grafana',
      }),
      new EnvironmentPlugin(envConfig),
    ],

    stats: 'minimal',
  });
};
