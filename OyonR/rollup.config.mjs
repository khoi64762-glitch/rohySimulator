import { nodeResolve } from '@rollup/plugin-node-resolve';
import { minify } from 'terser';

function terser(options = {}) {
  return {
    name: 'terser',
    async renderChunk(code, _chunk, outputOptions) {
      const sourceMap = outputOptions.sourcemap === true || typeof outputOptions.sourcemap === 'string';
      const result = await minify(code, { ...options, sourceMap });
      const minifiedCode = result.code || code;
      if (sourceMap && result.map) {
        return {
          code: minifiedCode,
          map: typeof result.map === 'string' ? JSON.parse(result.map) : result.map,
        };
      }
      return minifiedCode;
    },
  };
}

const externalDeps = ['@mediapipe/tasks-vision', 'onnxruntime-web', 'react', 'react-dom', 'webgazer'];
const isExternal = id => (
  id.endsWith('vendor/webeyetrack.js')
  || externalDeps.some(dep => id === dep || id.startsWith(`${dep}/`))
);

const banner = `/*! oyon v${process.env.npm_package_version || '0.0.0'} | MIT | https://github.com/mohsaqr/Oyon */`;

export default [
  {
    input: 'src/index.js',
    external: isExternal,
    plugins: [nodeResolve({ preferBuiltins: false })],
    output: [
      {
        file: 'dist/oyon.esm.js',
        format: 'es',
        sourcemap: true,
        banner,
      },
    ],
  },
  {
    input: 'src/index.js',
    external: isExternal,
    plugins: [nodeResolve({ preferBuiltins: false })],
    output: [
      {
        file: 'dist/oyon.umd.js',
        format: 'umd',
        name: 'Oyon',
        sourcemap: true,
        banner,
        globals: {
          '@mediapipe/tasks-vision': 'MediaPipeTasksVision',
          'onnxruntime-web': 'ort',
          react: 'React',
          'react-dom': 'ReactDOM',
          webgazer: 'webgazer',
        },
      },
      {
        file: 'dist/oyon.umd.min.js',
        format: 'umd',
        name: 'Oyon',
        sourcemap: true,
        banner,
        plugins: [terser({ format: { comments: /^!/ } })],
        globals: {
          '@mediapipe/tasks-vision': 'MediaPipeTasksVision',
          'onnxruntime-web': 'ort',
          react: 'React',
          'react-dom': 'ReactDOM',
          webgazer: 'webgazer',
        },
      },
    ],
  },
];
