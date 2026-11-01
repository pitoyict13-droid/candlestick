const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api/binance',
    createProxyMiddleware({
      target: 'https://data-api.binance.vision',
      changeOrigin: true,
      pathRewrite: {
        '^/api/binance': '',
      },
    })
  );
};
