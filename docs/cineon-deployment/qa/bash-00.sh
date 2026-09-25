npm ci --prefix backend-node
npm ci --prefix frontend
ffmpeg -version
ffprobe -version
npm test --prefix backend-node
npm test --prefix frontend
npm run build --prefix frontend
cd frontend
npx tsc --noEmit
cd ..
