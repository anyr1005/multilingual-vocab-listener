import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 상대 경로를 사용하면 username.github.io/repo/ 와 사용자 지정 도메인 양쪽에서 동작합니다.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // 단어장(/)과 스크립트 듣기(script/)는 별도 페이지입니다.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        script: fileURLToPath(new URL('./script/index.html', import.meta.url)),
      },
    },
  },
});
