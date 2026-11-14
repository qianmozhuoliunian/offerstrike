export function workbenchClient(output) {
  const access = /#access=([a-f0-9]{64})/.exec(output)?.[1];
  if (!access) throw Error('Local workbench did not print an access link');
  return (url, options = {}) => fetch(url,{...options,headers:{...options.headers,'x-offerpilot-access':access}});
}
