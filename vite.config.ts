import { defineConfig } from 'vite';

// 상대 경로를 사용하면 username.github.io/repo/ 와 사용자 지정 도메인 양쪽에서 동작합니다.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
