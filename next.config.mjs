/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  async headers() {
    return [
      {
        source: '/openship/source.tar.gz',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
    ]
  },
};
export default nextConfig;
