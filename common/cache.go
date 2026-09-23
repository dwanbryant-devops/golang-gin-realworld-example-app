package common

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
)

// Optional read-through cache backed by Valkey/Redis. When REDIS_URL is unset or
// the cache is unreachable, every call is a miss and the API serves from the DB.

var cacheClient *redis.Client

var cacheRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
	Name: "realworld_cache_requests_total",
	Help: "Cache lookups by key prefix and result (hit, miss, error).",
}, []string{"key", "result"})

func init() {
	prometheus.MustRegister(cacheRequests)
}

// InitCache connects to REDIS_URL (e.g. rediss://:token@host:6379/0) if set.
func InitCache() {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		return
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		log.Println("cache disabled: invalid REDIS_URL:", err)
		return
	}
	opts.DialTimeout = 2 * time.Second
	opts.ReadTimeout = 500 * time.Millisecond
	opts.WriteTimeout = 500 * time.Millisecond
	cacheClient = redis.NewClient(opts)
}

// CacheGet returns the cached bytes for key, or ok=false on miss/error.
func CacheGet(key string) ([]byte, bool) {
	if cacheClient == nil {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	b, err := cacheClient.Get(ctx, key).Bytes()
	switch {
	case err == nil:
		cacheRequests.WithLabelValues(key, "hit").Inc()
		return b, true
	case err == redis.Nil:
		cacheRequests.WithLabelValues(key, "miss").Inc()
	default:
		cacheRequests.WithLabelValues(key, "error").Inc()
	}
	return nil, false
}

// CacheSet stores value under key with a TTL; failures are ignored.
func CacheSet(key string, value []byte, ttl time.Duration) {
	if cacheClient == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	_ = cacheClient.Set(ctx, key, value, ttl).Err()
}

// CacheDelete invalidates key; failures are ignored (the TTL bounds staleness).
func CacheDelete(key string) {
	if cacheClient == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	_ = cacheClient.Del(ctx, key).Err()
}
