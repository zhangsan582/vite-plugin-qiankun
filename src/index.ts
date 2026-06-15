import cheerio, { CheerioAPI, Element } from 'cheerio'
import { PluginOption } from 'vite'

const helperIds = new Set([
  'vite-plugin-qiankun/dist/helper',
  'vite-plugin-qiankun/es/helper'
])
const virtualHelperId = '\0vite-plugin-qiankun:helper'

const createHelper = (qiankunName: string) => `
  export const qiankunWindow = typeof window !== 'undefined' ? (window.proxy || window) : {};

  export const renderWithQiankun = (qiankunLifeCycle, name) => {
    if (qiankunWindow && qiankunWindow.__POWERED_BY_QIANKUN__) {
      if (!window.moudleQiankunAppLifeCycles) {
        window.moudleQiankunAppLifeCycles = {};
      }
      const appName = name || '${qiankunName}' || window.qiankunName || qiankunWindow.qiankunName;
      if (appName) {
        window.moudleQiankunAppLifeCycles[appName] = qiankunLifeCycle;
      }
    }
  };

  export default renderWithQiankun;
`

const createQiankunHelper = (qiankunName: string) => `
  const qiankunProxy = window.proxy;
  const createDeffer = (hookName) => {
    const d = new Promise((resolve, reject) => {
      qiankunProxy && (qiankunProxy[\`vite\${hookName}\`] = resolve)
    })
    return props => d.then(fn => fn(props));
  }
  const bootstrap = createDeffer('bootstrap');
  const mount = createDeffer('mount');
  const unmount = createDeffer('unmount');
  const update = createDeffer('update');

  ;(global => {
    global.qiankunName = '${qiankunName}';
    global['${qiankunName}'] = {
      bootstrap,
      mount,
      unmount,
      update,
      __viteQiankunProxy: qiankunProxy
    };
  })(window);
`

// eslint-disable-next-line no-unused-vars
const replaceSomeScript = ($: CheerioAPI, findStr: string, replaceStr: string = '') => {
  $('script').each((i, el) => {
    if ($(el).html()?.includes(findStr)) {
      $(el).html(replaceStr)
    }
  })
}

const createImportFinallyResolve = (qiankunName: string) => {
  return `
    const qiankunLifeCycle = window.moudleQiankunAppLifeCycles && window.moudleQiankunAppLifeCycles['${qiankunName}'];
    const qiankunApp = window['${qiankunName}'];
    const qiankunProxy = qiankunApp && qiankunApp.__viteQiankunProxy ? qiankunApp.__viteQiankunProxy : window.proxy;
    if (qiankunLifeCycle && qiankunProxy) {
      qiankunProxy.vitemount((props) => qiankunLifeCycle.mount(props));
      qiankunProxy.viteunmount((props) => qiankunLifeCycle.unmount(props));
      qiankunProxy.vitebootstrap(() => qiankunLifeCycle.bootstrap());
      qiankunProxy.viteupdate((props) => qiankunLifeCycle.update(props));
    }
  `
}

export type MicroOption = {
  useDevMode?: boolean
}
type PluginFn = (qiankunName: string, microOption?: MicroOption) => PluginOption;

const htmlPlugin: PluginFn = (qiankunName, microOption = {}) => {
  let isProduction: boolean
  let base = ''

  const module2DynamicImport = ($: CheerioAPI, scriptTag: Element) => {
    if (!scriptTag) {
      return
    }
    const script$ = $(scriptTag)
    const moduleSrc = script$.attr('src')
    let appendBase = ''
    if (microOption.useDevMode && !isProduction) {
      appendBase = `((window['${qiankunName}'] && window['${qiankunName}'].__viteQiankunProxy) ? (window['${qiankunName}'].__viteQiankunProxy.__INJECTED_PUBLIC_PATH_BY_QIANKUN__ + '..') : '') + `
    }
    script$.removeAttr('src')
    script$.removeAttr('type')
    script$.html(`import(${appendBase}'${moduleSrc}')`)
    return script$
  }

  return {
    name: 'qiankun-html-transform',
    enforce: 'pre',
    configResolved (config) {
      isProduction = config.command === 'build' || config.isProduction
      base = config.base
    },

    resolveId (id) {
      if (helperIds.has(id)) {
        return virtualHelperId
      }
    },

    load (id) {
      if (id === virtualHelperId) {
        return createHelper(qiankunName)
      }
    },

    configureServer (server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          if (isProduction || !microOption.useDevMode) {
            next()
            return
          }
          const end = res.end.bind(res)
          res.end = (...args: any[]) => {
            let [htmlStr, ...rest] = args
            if (typeof htmlStr === 'string') {
              const $ = cheerio.load(htmlStr)
              module2DynamicImport($, $(`script[src=${base}@vite/client]`).get(0))
              htmlStr = $.html()
            }
            end(htmlStr, ...rest)
          }
          next()
        })
      }
    },
    transformIndexHtml (html: string) {
      const $ = cheerio.load(html)
      const moduleTags = $('body script[type=module], head script[crossorigin=""]')
      if (!moduleTags || !moduleTags.length) {
        return
      }
      const len = moduleTags.length
      moduleTags.each((i, moduleTag) => {
        const script$ = module2DynamicImport($, moduleTag)
        if (len - 1 === i) {
          script$?.html(`${script$.html()}.finally(() => {
            ${createImportFinallyResolve(qiankunName)}
          })`)
        }
      })

      $('body').prepend(`<script>${createQiankunHelper(qiankunName)}</script>`)
      const output = $.html()
      return output
    }
  }
}

export default htmlPlugin
