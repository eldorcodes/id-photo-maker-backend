Here’s a complete README.md you can copy‑paste. It documents the project, local dev, APIs, and Cloud Run deploy with the exact routes and flows we built.

⸻

ID Photo Maker

All‑in‑one mobile + backend app to create compliant ID photos (passport, visa, US DV Lottery).
	•	✂️ AI background removal (keeps skin tones intact)
	•	🎯 DV auto‑adjust (head % & eye line %)
	•	🖼️ Export PNG/JPEG + print sheets (A4 / Letter / 4×6)
	•	☁️ Cloud Run‑ready backend (Node + Express + sharp)

⸻

Monorepo Layout

id-photo-maker/
├── app/                         # React Native (Expo) app
│   ├── src/
│   │   ├── screens/             # HomeScreen, EditScreen, ExportScreen
│   │   ├── components/          # SizePicker etc.
│   │   └── utils/               # api.js, exporter.js, validators.js, sizes.js
│   ├── app.json                 # Expo config (permissions, icons, etc.)
│   └── package.json
└── id-photo-maker-backend/      # Node/Express API (Cloud Run)
    ├── routes/                  # bg-remove, compose, compose-pdf, refine-mask, sizes, health
    ├── src/                     # aiMatting.js etc.
    ├── sizes.json               # dynamic size catalog served by /sizes
    ├── server.js                # Express app entry
    ├── Dockerfile               # Prod container for Cloud Run
    ├── .dockerignore
    └── package.json


⸻

Requirements
	•	Node.js 18+ (we use Node 20 in Docker)
	•	Expo CLI for the app (npm i -g expo-cli)
	•	gcloud CLI for Cloud Run deploy
	•	macOS/Windows/Linux

⸻

Backend (Local)

cd id-photo-maker-backend
npm install
npm run dev        # nodemon server.js

	•	Server listens on http://localhost:8080
	•	JSON body limit defaults to 30 MB (configurable via MAX_BODY_MB)

Environment (optional)

Create .env (or use real env vars):

PORT=8080
LOG_LEVEL=info
MAX_BODY_MB=30
CORS_ORIGIN=*
NODE_ENV=development

We already bind to process.env.PORT and host 0.0.0.0 (Cloud Run compatible).

⸻

Frontend (Expo)

cd app
npm install
npx expo start

	•	iOS Simulator / Android Emulator / physical device via Expo Go.
	•	Permissions: already declared in app.json
	•	iOS: NSCameraUsageDescription, NSPhotoLibraryUsageDescription, NSPhotoLibraryAddUsageDescription
	•	Android: CAMERA, READ_MEDIA_IMAGES, READ_EXTERNAL_STORAGE

Connect to Backend

Edit app/src/utils/api.js (or wherever you define the base URL):

export const BASE_URL = "http://localhost:8080"; // during local dev

For production, replace with your Cloud Run URL.

⸻

Key Endpoints

Health

GET /healthz
200 OK → { ok: true }

Sizes (dynamic size catalog for the app)

GET /sizes
200 OK → { sizes: { "US:passport": {...}, "US:dv-lottery": {...}, ... } }

Background Removal (AI)

POST /bg-remove
Content-Type: application/json
{
  "imageBase64": "<base64 png/jpg (data: prefix allowed)>",
  "format": "png" | "jpg",
  "quality": "ai" | "fast",
  "bgColor": "#ffffff" | "transparent",
  "transparent_background": true | false
}

200 OK → {
  "imageBase64": "<base64>",
  "mode": "ai" | "fast",
  "transparent": true | false,
  "ms": 1234
}

	•	AI path returns a true cut‑out (PNG with alpha if transparent_background=true).
	•	Fast path falls back to heuristic white flatten.

Refine Mask

POST /refine-mask
{
  "imageBase64": "<base64>",
  "hardThreshold": 0.6,
  "soften": 0.5,
  "hairDetail": true,
  "bgColor": "#ffffff",
  "transparent": true
}
→ 200 OK { imageBase64: "<base64>" }

Compose Final (DV + General)

POST /api/compose
{
  "templateKey": "US:dv-lottery" | "...",
  "imageBase64": "<cutout png base64 (alpha ok)>",
  "width": 600,
  "height": 600,
  "bgColor": "#ffffff",
  "format": "jpg" | "png",
  "autoAdjust": {
    "headBox": { "top": 120, "bottom": 480 },
    "rules": {
      "head_pct": { "min": 0.50, "max": 0.69 },
      "eyes_from_bottom_pct": { "min": 0.56, "max": 0.69 }
    }
  }
}
→ 200 OK {
  ok: true,
  width: 600,
  height: 600,
  format: "jpg",
  imageBase64: "<final base64>"
}

	•	DV (US:dv-lottery) is always square and JPEG with pure white background.
	•	Auto‑adjust scales/positions head and eyes to midpoints of allowed ranges.

Compose Print Sheet (A4 / Letter / 4×6)

POST /compose-pdf
{
  "items": [
    { "imageBase64": "<base64>", "pxW": 413, "pxH": 531 }
  ],
  "paper": { "type": "A4" | "Letter" | "4x6", "dpi": 300 },
  "margins": { "mm": 5 },
  "cutGuides": true,
  "fill": true
}
→ 200 OK { pdfBase64: "<base64>" }


⸻

iOS/Android Permissions

Already configured in app/app.json:

{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "This app requires access to your camera to take ID photos.",
        "NSPhotoLibraryUsageDescription": "This app requires access to your photo library to select ID photos.",
        "NSPhotoLibraryAddUsageDescription": "This app requires access to save processed ID photos to your photo library."
      }
    },
    "android": {
      "permissions": [
        "CAMERA",
        "READ_MEDIA_IMAGES",
        "READ_EXTERNAL_STORAGE"
      ]
    }
  }
}

Changes to app.json require a new EAS build (or custom dev client), not just a Metro reload.

⸻

Cloud Run Deployment

One‑time (create project + link billing)

# login
gcloud auth login
gcloud auth application-default login

# choose IDs
export PROJECT_ID="studybridge-idphoto"      # must be globally unique
export REGION="us-central1"
export SERVICE_NAME="idphoto-backend"

# create project + set
gcloud projects create "$PROJECT_ID" --name="ID Photo Backend"
gcloud config set project "$PROJECT_ID"
gcloud auth application-default set-quota-project "$PROJECT_ID"

# billing (choose an ID from the list)
gcloud beta billing accounts list
export BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"
gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"

# enable apis
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud config set run/region "$REGION"

Dockerfile (already included)

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates dumb-init libvips \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false PORT=8080
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
EXPOSE 8080

.dockerignore:

node_modules
npm-debug.log
.git
.DS_Store
.env

Deploy

cd id-photo-maker-backend

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --allow-unauthenticated \
  --region "$REGION" \
  --port 8080 \
  --cpu 2 \
  --memory 1Gi \
  --timeout 120 \
  --set-env-vars 'NODE_ENV=production,CORS_ORIGIN=*,MAX_BODY_MB=30'

Verify

export SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
echo "$SERVICE_URL"

curl -s "$SERVICE_URL/healthz"
curl -s "$SERVICE_URL/bg-remove/selftest"
curl -s "$SERVICE_URL/sizes" | head

Update your app’s BASE_URL with SERVICE_URL.

⸻

DV Rules (quick reference)
	•	Canvas: square 600–1200 px (we default to 600×600)
	•	Head height: 50–69% of canvas
	•	Eye line from bottom: 56–69% of canvas
	•	Background: pure white
	•	Output: JPEG

The backend’s /api/compose auto‑adjust centers to the midpoints of these ranges.

⸻

Troubleshooting
	•	“Cannot find native module ‘ExpoFaceDetector’”
	•	In Expo Go, face detection is not available. Our code auto‑disables it in Expo Go and continues. Use EAS dev build or custom client to enable face detection locally.
	•	“Image to composite must have same dimensions or smaller”
	•	Fixed by ensuring we scale the cut‑out to <= canvas and center before compositing.
	•	CORS
	•	Set CORS_ORIGIN env var (Cloud Run) to your app’s domain.
	•	Large uploads
	•	Cloud Run max body ≈ 32 MB. Base64 inflates ~33%. Consider multipart/binary or GCS upload if you hit limits.

⸻

Acknowledgements
	•	sharp for fast image processing
	•	@imgly/background-removal-node for high‑quality matting

⸻

License

MIT © You / Your Company Name

⸻

If you want, I can also generate a minimal POSTMAN collection JSON for the main endpoints to import and test quickly.
