// Preloaded by the coverage and package scripts: some sandboxed runners report zero CPUs,
// and nyc and vsce size their worker pools from os.cpus().
const os = require('node:os');

const originalCpus = os.cpus;

os.cpus = function patchedCpus() {
  const cpus = originalCpus.call(os);

  if (Array.isArray(cpus) && cpus.length > 0) {
    return cpus;
  }

  return [
    {
      model: 'unknown',
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
    }
  ];
};
