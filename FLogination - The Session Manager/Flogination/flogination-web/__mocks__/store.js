// Minimal store mock for testing pure helper functions exported from view components
const useStore = () => ({
  sessions: [],
  warmUpJobs: [],
  fetchWarmUpJobs: async () => {},
  createWarmUpJob: async () => {},
  pauseWarmUpJob: async () => {},
  startWarmUpJob: async () => {},
  deleteWarmUpJob: async () => {},
});

module.exports = { useStore };
module.exports.useStore = useStore;
module.exports.startPolling = () => () => {};
