declare global {
  namespace React.JSX {
    interface IntrinsicElements {
      'ion-icon': {
        name?: string
        size?: string | number
        class?: string
        className?: string
        color?: string
        style?: import('react').CSSProperties
      }
    }
  }
}

export {}
