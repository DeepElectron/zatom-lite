import { assertDeepEqual, assertEqual } from '../testing/assert'
import { createCrystalStore } from '../orchestration/crystalStore'

function testDomainWallReviewCanBeStoredAndCleared() {
  const store = createCrystalStore()
  const review = {
    summaryStatus: 'pass',
    checks: {
      composition: { status: 'pass' },
      interfacePosition: { status: 'pass' },
      polarity: { status: 'pass' },
      passivation: { status: 'pass' },
    },
  }

  assertEqual(store.getState().domainWallReview, null)
  store.getState().setDomainWallReview(review)
  assertDeepEqual(store.getState().domainWallReview, review)
  store.getState().clearDomainWallReview()
  assertEqual(store.getState().domainWallReview, null)
}

testDomainWallReviewCanBeStoredAndCleared()
console.log('domain wall review store tests passed')
