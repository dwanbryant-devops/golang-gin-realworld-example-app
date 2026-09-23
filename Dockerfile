# syntax=docker/dockerfile:1

# ---- build ----
FROM golang:1.27-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
# Static binary: production uses Postgres (pure Go driver), so CGO/SQLite isn't needed.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api .

# ---- runtime ----
# Distroless: no shell or package manager, runs as non-root (65532).
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER 65532:65532
EXPOSE 8080
ENV GIN_MODE=release PORT=8080
ENTRYPOINT ["/api"]
