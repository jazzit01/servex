export const foodLibrary = [
  { id: 'paneer-tikka', name: 'Paneer Tikka', group: 'Starters' },
  { id: 'chicken-tikka', name: 'Chicken Tikka', group: 'Starters' },
  { id: 'chicken-kebab', name: 'Chicken Kebab', group: 'Starters' },
  { id: 'spring-rolls', name: 'Spring Rolls', group: 'Starters' },
  { id: 'french-fries', name: 'French Fries', group: 'Starters' },
  { id: 'samosa', name: 'Samosa', group: 'Starters' },
  { id: 'soup', name: 'Soup', group: 'Starters' },
  { id: 'masala-papad', name: 'Masala Papad', group: 'Starters' },
  { id: 'veg-biryani', name: 'Veg Biryani', group: 'Main Course' },
  { id: 'chicken-biryani', name: 'Chicken Biryani', group: 'Main Course' },
  { id: 'butter-chicken', name: 'Butter Chicken', group: 'Main Course' },
  { id: 'paneer-butter-masala', name: 'Paneer Butter Masala', group: 'Main Course' },
  { id: 'dal-tadka', name: 'Dal Tadka', group: 'Main Course' },
  { id: 'dal-makhani', name: 'Dal Makhani', group: 'Main Course' },
  { id: 'veg-pulao', name: 'Veg Pulao', group: 'Main Course' },
  { id: 'fried-rice', name: 'Fried Rice', group: 'Main Course' },
  { id: 'noodles', name: 'Noodles', group: 'Main Course' },
  { id: 'pizza', name: 'Pizza', group: 'Main Course' },
  { id: 'burger', name: 'Burger', group: 'Main Course' },
  { id: 'sandwich', name: 'Sandwich', group: 'Main Course' },
  { id: 'thali', name: 'Thali', group: 'Main Course' },
  { id: 'masala-chai', name: 'Masala Chai', group: 'Beverages & Desserts' },
  { id: 'cold-coffee', name: 'Cold Coffee', group: 'Beverages & Desserts' },
  { id: 'cappuccino', name: 'Cappuccino', group: 'Beverages & Desserts' },
  { id: 'fresh-lime-soda', name: 'Fresh Lime Soda', group: 'Beverages & Desserts' },
  { id: 'mango-lassi', name: 'Mango Lassi', group: 'Beverages & Desserts' },
  { id: 'ice-cream', name: 'Ice Cream', group: 'Beverages & Desserts' },
  { id: 'gulab-jamun', name: 'Gulab Jamun', group: 'Beverages & Desserts' },
  { id: 'brownie', name: 'Brownie', group: 'Beverages & Desserts' },
] as const

export const foodReference = (id: string) => 'library:' + id
const references = new Map<string, string>(foodLibrary.map(item => [foodReference(item.id), item.id]))
export const foodIdFromReference = (ref: string | null) => ref ? references.get(ref) : undefined
export const foodReferenceForName = (name: string) => {
  const item = foodLibrary.find(row => row.name === name)
  return item ? foodReference(item.id) : null
}
