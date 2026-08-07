#!/bin/sh

# Build Karaoke Eternal into the local Docker image store used by TrueNAS Apps.
# Run this from a clone of the repository on the TrueNAS host.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
IMAGE_TAG=${IMAGE_TAG:-karaoke-eternal:transcode}
PURGE=false

usage() {
  cat <<EOF
Usage: $0 [--purge] [--help]

Build $IMAGE_TAG for the local TrueNAS Docker image store.

  --purge  Remove unused Docker build cache and dangling images, then rebuild
           without cache. Named images, containers, volumes, and app data are
           not removed.
  --help   Show this help text.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge)
      PURGE=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker was not found. This requires a Docker-based TrueNAS SCALE release." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: cannot access Docker. Run this as a user with Docker access (or with sudo)." >&2
  exit 1
fi

if [ ! -f "$REPO_DIR/Dockerfile" ]; then
  echo "Error: Dockerfile not found at $REPO_DIR/Dockerfile" >&2
  exit 1
fi

BUILD_ARGS=
if [ "$PURGE" = true ]; then
  echo "Purging unused Docker build cache and dangling images..."
  docker builder prune --all --force
  docker image prune --force
  BUILD_ARGS=--no-cache
fi

echo "Building $IMAGE_TAG from $REPO_DIR"
docker build $BUILD_ARGS --tag "$IMAGE_TAG" "$REPO_DIR"

echo
echo "Image is ready in the TrueNAS Docker image store:"
docker image inspect --format '  {{.RepoTags}} ({{.Id}})' "$IMAGE_TAG"
echo
echo "In TrueNAS, open Apps > Discover Apps > Install via YAML and paste docker-compose.yml."
