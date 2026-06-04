// Minimal React mock for testing pure helper functions exported from 'use client' components

// Minimal Component base class — supports class components that extend React.Component
class Component {
  constructor(props) {
    this.props = props;
    this.state = {};
  }
  setState() {}
  render() { return null; }
}

const React = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useId: () => 'mock-id',
  createElement: () => null,
  Component,
};

module.exports = React;
module.exports.default = React;
module.exports.useState = React.useState;
module.exports.useEffect = React.useEffect;
module.exports.useRef = React.useRef;
module.exports.useCallback = React.useCallback;
module.exports.useMemo = React.useMemo;
module.exports.useId = React.useId;
module.exports.Component = Component;
