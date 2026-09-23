// k6 load profile for performance-regression checks in CI.
// Seeds a user and articles, then mixes the hot read paths with some writes.
// Each request is tagged with `name`, and a threshold per name makes k6 export a
// per-endpoint latency breakdown that perf/compare.py diffs between two builds.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.API_URL || 'http://localhost:8080/api';
const ENDPOINTS = ['list_articles', 'get_article', 'list_tags', 'feed', 'create_comment'];

export const options = {
  scenarios: {
    steady: { executor: 'constant-vus', vus: Number(__ENV.VUS || 10), duration: __ENV.DURATION || '45s' },
  },
  thresholds: Object.fromEntries([
    ['http_req_failed', ['rate<0.01']],
    ...ENDPOINTS.map((n) => [`http_req_duration{name:${n}}`, ['p(95)<5000']]),
  ]),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const json = { headers: { 'Content-Type': 'application/json' } };

export function setup() {
  const id = `${Date.now()}`;
  const user = { username: `perf${id}`, email: `perf${id}@example.com`, password: 'perf-password-123' };
  const reg = http.post(`${BASE}/users`, JSON.stringify({ user }), json);
  check(reg, { registered: (r) => r.status === 201 || r.status === 200 });
  const token = reg.json('user.token');
  const auth = { headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` } };

  const slugs = [];
  for (let i = 0; i < 30; i++) {
    const article = {
      title: `Perf article ${id}-${i}`,
      description: 'load test',
      body: 'x'.repeat(2000),
      tagList: [`tag${i % 8}`, 'perf'],
    };
    const res = http.post(`${BASE}/articles`, JSON.stringify({ article }), auth);
    slugs.push(res.json('article.slug'));
  }
  return { token, slugs };
}

export default function (data) {
  const auth = { headers: { 'Content-Type': 'application/json', Authorization: `Token ${data.token}` } };
  const slug = data.slugs[Math.floor(Math.random() * data.slugs.length)];

  check(http.get(`${BASE}/articles?limit=20`, { tags: { name: 'list_articles' } }), { 'list 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/articles/${slug}`, { tags: { name: 'get_article' } }), { 'get 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/tags`, { tags: { name: 'list_tags' } }), { 'tags 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/articles/feed`, { ...auth, tags: { name: 'feed' } }), { 'feed 200': (r) => r.status === 200 });

  if (Math.random() < 0.2) {
    const comment = { body: 'perf comment' };
    check(
      http.post(`${BASE}/articles/${slug}/comments`, JSON.stringify({ comment }), { ...auth, tags: { name: 'create_comment' } }),
      { 'comment 2xx': (r) => r.status === 200 || r.status === 201 },
    );
  }
}
