// 运行时配置：部署后由运维填入实际值，构建时不需要知道。
// 这样同一个构建产物可以部署到不同环境（GitHub Pages、自有域名等），
// 只需改这个文件，不需要重新 build。
window.__MAJORFIT_CONFIG__ = {
  // 统计服务的完整 URL，例如：
  //   "https://majorfit-stats.your-subdomain.workers.dev/api/events"
  // 留空则默认走同源 /api/events（适用于 Nginx 反代场景）
  statsEndpoint: '',
};
