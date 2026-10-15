import {parseSpec, compareSpecs, attachSources} from './engine.mjs';
self.onmessage = ({data}) => {
  try {
    let report = compareSpecs(parseSpec(data.before, 'Current contract'), parseSpec(data.after, 'Next contract'));
    report = attachSources(report, data.sources);
    self.postMessage({report});
  } catch(error) { self.postMessage({error: error.message}); }
};
