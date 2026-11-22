import ExpoIonicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import {
  createContext,
  useContext,
  useEffect,
  type ComponentProps,
  type PropsWithChildren,
} from 'react';
import { Text } from 'react-native';

const IconFontReady = createContext(false);
type IconProps = ComponentProps<typeof ExpoIonicons>;

const fallbackGlyphs: Partial<Record<IconProps['name'], string>> = {
  add: '+',
  checkmark: '✓',
  'close-outline': '×',
  'home-outline': '⌂',
  'pencil-outline': '✎',
  'trash-outline': '⌫',
};

export function IconFontProvider({ children }: PropsWithChildren) {
  const [loaded, error] = useFonts(ExpoIonicons.font);

  useEffect(() => {
    if (error) console.warn('Could not load the Ionicons font.', error.message);
  }, [error]);

  return (
    <IconFontReady.Provider value={loaded}>{children}</IconFontReady.Provider>
  );
}

export default function Ionicons(props: IconProps) {
  const loaded = useContext(IconFontReady);
  if (loaded) return <ExpoIonicons {...props} />;

  return (
    <Text
      accessible={false}
      style={[{ color: props.color, fontSize: props.size }, props.style]}
    >
      {fallbackGlyphs[props.name]}
    </Text>
  );
}
