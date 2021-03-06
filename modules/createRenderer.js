import generatePropsReference from './utils/generatePropsReference'
import sortedStringify from './utils/sortedStringify'
import getFontFormat from './utils/getFontFormat'

import processStyle from './utils/processStyle'
import diffStyle from './utils/diffStyle'

import cssifyKeyframe from './utils/cssifyKeyframe'
import cssifyObject from './utils/cssifyObject'

export default function createRenderer(config = { }) {
  let renderer = {
    listeners: [],
    keyframePrefixes: config.keyframePrefixes || [ '-webkit-', '-moz-' ],
    plugins: config.plugins || [ ],

    /**
     * clears the sheet's cache but keeps all listeners
     */
    clear() {
      renderer.fontFaces = ''
      renderer.keyframes = ''
      renderer.statics = ''
      renderer.rules = ''
      renderer.mediaRules = { }
      renderer.rendered = { }
      renderer.base = { }
      renderer.ids = [ ]

      // emit changes to notify subscribers
      renderer._emitChange()
    },

    /**
     * renders a new rule variation and caches the result
     *
     * @param {Function} rule - rule which gets rendered
     * @param {Object?} props - properties used to render
     * @return {string} className to reference the rendered rule
     */
    renderRule(rule, props = { }) {
      // rendering a rule for the first time
      // will create an ID reference
      if (renderer.ids.indexOf(rule) < 0) {
        renderer.ids.push(rule)

        // directly render the static base style to be able
        // to diff future dynamic style with those
        if (Object.keys(props).length > 0) {
          renderer.renderRule(rule, { })
        }
      }

      // uses the reference ID and the props to generate an unique className
      const ruleId = renderer.ids.indexOf(rule)
      const className = 'c' + ruleId + generatePropsReference(props)

      // only if the cached rule has not already been rendered
      // with a specific set of properties it actually renders
      if (!renderer.rendered.hasOwnProperty(className)) {
        const resolvedStyle = renderer._resolveStyle(rule, props)
        const diffedStyle = diffStyle(resolvedStyle, renderer.base[ruleId])

        if (Object.keys(diffedStyle).length > 0) {
          const style = processStyle(diffedStyle, {
            type: 'rule',
            className: className,
            id: ruleId,
            props: props,
            rule: rule
          }, renderer.plugins)

          renderer._renderStyle(className, style)

          renderer.rendered[className] = renderer._didChange

          if (renderer._didChange) {
            renderer._didChange = false
            renderer._emitChange()
          }
        } else {
          renderer.rendered[className] = false
        }

        // keep static style to diff dynamic onces later on
        if (className === 'c' + ruleId) {
          renderer.base[ruleId] = resolvedStyle
        }
      }

      const baseClassName = 'c' + ruleId
      if (!renderer.rendered[className]) {
        return baseClassName
      }

      // returns either the base className or both the base and the dynamic part
      return className !== baseClassName ? baseClassName + ' ' + className : className
    },

    /**
     * renders a new keyframe variation and caches the result
     *
     * @param {Keyframe} keyframe - Keyframe which gets rendered
     * @param {Object?} props - properties used to render
     * @return {string} animationName to reference the rendered keyframe
     */
    renderKeyframe(keyframe, props = { }) {
      // rendering a Keyframe for the first time
      // will create cache entries and an ID reference
      if (renderer.ids.indexOf(keyframe) < 0) {
        renderer.ids.push(keyframe)
      }

      const propsReference = generatePropsReference(props)
      const animationName = 'k' + renderer.ids.indexOf(keyframe) + propsReference

      // only if the cached keyframe has not already been rendered
      // with a specific set of properties it actually renders
      if (!renderer.rendered.hasOwnProperty(animationName)) {
        const processedKeyframe = processStyle(renderer._resolveStyle(keyframe, props), {
          type: 'keyframe',
          keyframe: keyframe,
          props: props,
          animationName: animationName,
          id: renderer.ids.indexOf(keyframe)
        }, renderer.plugins)

        const css = cssifyKeyframe(processedKeyframe, animationName, renderer.keyframePrefixes)
        renderer.rendered[animationName] = true
        renderer.keyframes += css
        renderer._emitChange()
      }

      return animationName
    },

    /**
     * renders a new font-face and caches it
     *
     * @param {FontFace} fontFace - fontFace which gets rendered
     * @return {string} fontFamily reference
     */
    renderFont(family, files, properties = { }) {
      const key = family + generatePropsReference(properties)
      
      if (!renderer.rendered.hasOwnProperty(key)) {
        const fontFace = {
          fontFamily: '\'' + family + '\'',
          src: files.map(src => 'url(\'' + src + '\') format(\'' + getFontFormat(src) + '\')').join(',')
        }

        const fontProperties = [ 'fontVariant', 'fontWeight', 'fontStretch', 'fontStyle', 'unicodeRange' ]
        Object.keys(properties).filter(prop => fontProperties.indexOf(prop) > -1).forEach(fontProp => fontFace[fontProp] = properties[fontProp])

        const css = '@font-face{' + cssifyObject(fontFace) + '}'
        renderer.rendered[key] = true
        renderer.fontFaces += css
        renderer._emitChange()
      }

      return family
    },

    /**
     * renders static style and caches them
     *
     * @param {string|Object} style - static style to be rendered
     * @param {string?} selector - selector used to render the styles
     * @return {string} rendered CSS output
     */
    renderStatic(style, selector) {
      const reference = typeof style === 'string' ? style : selector + sortedStringify(style)

      if (!renderer.rendered.hasOwnProperty(reference)) {
        if (typeof style === 'string') {
          // remove new lines from template strings
          renderer.statics += style.replace(/\s{2,}/g, '')
        } else {
          const processedStyle = processStyle(style, {
            selector: selector,
            type: 'static'
          }, renderer.plugins)
          renderer.statics += selector + '{' + cssifyObject(processedStyle) + '}'
        }

        renderer.rendered[reference] = true
        renderer._emitChange()
      }
    },

    /**
     * renders all cached styles into a single valid CSS string
     * clusters media query styles into groups to reduce output size

     * @return single concatenated CSS string
     */
    renderToString() {
      let css = renderer.fontFaces + renderer.statics + renderer.rules

      for (let media in renderer.mediaRules) {
        css += '@media ' + media + '{' + renderer.mediaRules[media] + '}'
      }

      return css + renderer.keyframes
    },

    /**
     * Adds a new subscription to get notified on every rerender
     *
     * @param {Function} callback - callback function which will be executed
     * @return {Object} equivalent unsubscribe method
     */
    subscribe(callback) {
      renderer.listeners.push(callback)
      return {
        unsubscribe: () => renderer.listeners.splice(renderer.listeners.indexOf(callback), 1)
      }
    },

    /**
     * Encapsulated style resolving method
     *
     * @param {Function} style - rule or keyframe to be resolved
     * @param {Object} props - props used to resolve style
     * @return {Object} resolved style
     */
    _resolveStyle(style, props) {
      return style(props)
    },

    /**
     * calls each listener with the current CSS markup of all caches
     * gets only called if the markup actually changes
     *
     * @param {Function} callback - callback function which will be executed
     * @return {Object} equivalent unsubscribe method
     */
    _emitChange() {
      const css = renderer.renderToString()
      renderer.listeners.forEach(listener => listener(css))
    },

    /**
     * iterates a style object and renders each rule to the cache
     *
     * @param {string} className - className reference to be rendered to
     * @param {Object} style - style object which is rendered
     */
    _renderStyle(className, style, pseudo = '', media = '') {
      const ruleset = Object.keys(style).reduce((ruleset, property) => {
        const value = style[property]
        // recursive object iteration in order to render
        // pseudo class and media class declarations
        if (value instanceof Object && !Array.isArray(value)) {
          if (property.charAt(0) === ':') {
            renderer._renderStyle(className, value, pseudo + property, media)
          } else if (property.substr(0, 6) === '@media') {
            // combine media query rules with an `and`
            const query = property.slice(6).trim()
            const combinedMedia = media.length > 0 ? media + ' and ' + query : query
            renderer._renderStyle(className, value, pseudo, combinedMedia)
          }
        } else {
          ruleset[property] = value
        }
        return ruleset
      }, { })

      // add styles to the cache
      if (Object.keys(ruleset).length > 0) {
        const css = '.' + className + pseudo + '{' + cssifyObject(ruleset) + '}'
        renderer._didChange = true

        if (media.length > 0) {
          if (!renderer.mediaRules.hasOwnProperty(media)) {
            renderer.mediaRules[media] = ''
          }

          renderer.mediaRules[media] += css
        } else {
          renderer.rules += css
        }
      }
    }
  }

  // initial setup
  renderer.keyframePrefixes.push('')
  renderer.clear()

  // enhance renderer with passed set of enhancers
  if (config.enhancers) {
    config.enhancers.forEach(enhancer => renderer = enhancer(renderer))
  }

  return renderer
}
