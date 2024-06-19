import {expect} from 'chai'
import {stripIndent} from 'common-tags'

import {parseExiftoolMetadata, toDate} from '../../src/lib/metadata.ts'

describe('toDate', () => {
  it('parses valid date values', () => {
    expect(toDate('2024:05:25 15:35:05', '-05:00')).to.deep.equal({
      date: new Date('2024-05-25T15:35:05-05:00'),
      success: true,
    })
  })

  it('returns an error for invalid dto', () => {
    expect(toDate('some malformed data', '-05:00')).to.deep.equal({
      error: 'Could not parse DateTimeOriginal field',
      success: false,
    })
  })

  it('returns an error for invalid oto', () => {
    expect(toDate('2024:05:25 15:35:05', 'invalid offset')).to.deep.equal({
      error: 'Invalid date',
      success: false,
    })
  })
})

describe('parseExiftoolMetadata', () => {
  it('parses valid metadata', () => {
    const raw = stripIndent`
			Make                            : FUJIFILM
			Model                           : X-T4
			LensInfo                        : 27mm f/2.8
			LensMake                        : FUJIFILM
			LensModel                       : XF27mmF2.8 R WR
			ExposureTime                    : 1/1000
			FNumber                         : 8.0
			ISO                             : 1250
			DateTimeOriginal                : 2024:05:25 15:35:05
			OffsetTimeOriginal              : -05:00
			SomeAdditionalKey							  : SomeAdditionalValue
			AnotherUnusedKey							  : AnotherUnusedValue
		`
    expect(parseExiftoolMetadata(raw)).to.deep.equal({
      metadata: {
        cameraMake: 'FUJIFILM',
        cameraModel: 'X-T4',
        date: new Date('2024-05-25T15:35:05-05:00'),
        exposureTime: '1/1000',
        fNumber: '8.0',
        iso: '1250',
        lensMake: 'FUJIFILM',
        lensModel: 'XF27mmF2.8 R WR',
      },
      success: true,
    })
  })

  it('returns an error for invalid metadata', () => {
    expect(parseExiftoolMetadata('some malformed data')).to.deep.equal({
      error: 'Could not parse metadata',
      success: false,
    })
  })
})
