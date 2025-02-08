import { Client } from '@googlemaps/google-maps-services-js'

const client = new Client()

export const getAddress = async ({ lat, lng }: { lat: number, lng: number }) => {
  const response = await client.reverseGeocode({
    params: {
      latlng: { lat, lng },
      key: 'AIzaSyBnY062ImOtNuubHRZtqoPPFN_ZrI8VgKU', // process.env.GOOGLE_MAPS_API_KEY || '',
    },
  })
  console.log('GEO',response)
  const components = response.data.results[0].address_components
  // @ts-expect-error - components is an array of address components
  const city = components.find((component) => component.types.includes('locality'))
  // @ts-expect-error - components is an array of address components
  const country = components.find((component) => component.types.includes('country'))
  // @ts-expect-error - city and country are address components
  return { status: 'success', city: city.long_name, country: country.long_name }
}